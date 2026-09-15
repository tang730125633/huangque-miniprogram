#!/bin/bash
# 黄雀小程序自动发布脚本
# 流程：检测 origin/main 新提交 → 快进本地 main → 跑全量测试 → 用微信开发者工具 CLI 上传
# 事实：同账号上传会自动覆盖体验版，无需额外步骤（上传弹窗会提示「上次提交已被选为体验版」）
# 设计：幂等；无新提交直接退出；测试失败/未登录/记录异常时报错退出，绝不强行发布。
# 用法：bash scripts/publish-miniprogram.sh
set -u

REPO="/Users/xlzj/Desktop/21日的视频/huangque-miniprogram"
STATE="/Users/xlzj/.penguin/data/default_project/agents/default_agent/agent_state/miniprogram_release_state.json"
IDE_APP="/Applications/wechatwebdevtools.app"
CLI="$IDE_APP/Contents/MacOS/cli"
PROFILE_DIR="$HOME/Library/Application Support/微信开发者工具/d1e8765721a6c23d43b14c95b1843e6b/WeappLocalData"
PROJECTLIST="$PROFILE_DIR/localstorage_914f1d8fd4ec79bf7a0946881c319ec2.json"
PROJECT2="$PROFILE_DIR/localstorage_37d550dc53e1fd33dac7be03ff67397d.json"
TEMPLATE="$PROFILE_DIR/localstorage_9a4ffa56e52b396fb4ee306eec43f8d4.json"
WORKTREES="/Users/xlzj/Desktop/黄雀小程序-worktrees"
APPID="wx23904aa2aa91f4d6"
APPNAME="黄雀智创"

log(){ echo "[publish] $*"; }
fail(){ log "失败: $*"; exit 1; }

# ---------- 0. 前置 ----------
[ -d "$REPO" ] || fail "仓库不存在: $REPO"
[ -x "$CLI" ] || fail "微信开发者工具 CLI 不存在: $CLI"
mkdir -p "$(dirname "$STATE")"

# ---------- 1. 是否有新提交 ----------
log "git fetch origin"
git -C "$REPO" fetch origin >/dev/null 2>&1 || fail "git fetch 失败（网络?）"
HEAD=$(git -C "$REPO" rev-parse origin/main)
LAST=$(python3 -c "import json
try: print(json.load(open('$STATE')).get('last_published_commit',''))
except Exception: print('')" 2>/dev/null)
[ -n "$HEAD" ] || fail "拿不到 origin/main"
if [ -n "$LAST" ]; then
  case "$HEAD" in
    "$LAST"*) log "没有新提交（${HEAD}），无需发布"; exit 0;;
  esac
fi
log "检测到新提交: ${LAST:-无} -> $HEAD"

# ---------- 2. 更新本地并测试 ----------
git -C "$REPO" checkout main >/dev/null 2>&1 || fail "切不到 main（可能有未提交改动）"
git -C "$REPO" merge --ff-only origin/main >/dev/null 2>&1 || fail "本地 main 无法快进（有本地改动?），请人工处理"
log "运行全量测试"
T=$(cd "$REPO" && node --test tests/*.test.js 2>&1)
echo "$T" | grep -E "tests [0-9]+|pass [0-9]+|fail [0-9]+" | tail -3
echo "$T" | grep -qE "fail 0" || fail "测试有失败，不发布"

# ---------- 3. 计算下一个版本号 ----------
MAXW=$(ls "$WORKTREES" 2>/dev/null | grep -oE 'upload-0\.[0-9]+-[0-9]{8}' | grep -oE '0\.[0-9]+' | sort -V | tail -1)
LASTV=$(python3 -c "import json
try: print(json.load(open('$STATE')).get('last_published_version',''))
except Exception: print('')" 2>/dev/null)
NEXT=$(python3 -c "
import re
def parse(v):
    m=re.match(r'^(\d+)\.(\d+)\$', v or '')
    return (int(m.group(1)),int(m.group(2))) if m else (0,0)
best=(0,0)
for src in ['$MAXW','$LASTV']:
    if src: best=max(best,parse(src))
print(f'{best[0]}.{best[1]+1}')
")
log "版本号: ${NEXT}（上传工作树最大 ${MAXW}，状态 ${LASTV}）"

# ---------- 4. IDE 与项目记录 ----------
if pgrep -f "wechatwebdevtools.app/Contents/MacOS/Electron" >/dev/null; then
  log "IDE 已在运行，直接复用现有状态"
else
  log "IDE 未运行：先修复项目记录再启动"
  # project2_<path> 的 attr 里必须有 appid，否则 IDE 启动时会把项目列表记录削瘦导致 41002
  python3 - "$PROJECTLIST" "$PROJECT2" "$TEMPLATE" "$REPO" "$APPID" "$APPNAME" <<'PYEOF'
import json,sys
pl, p2, tpl, repo, appid, appname = sys.argv[1:7]
need_p2=False
try:
    h=json.load(open(p2))
except Exception:
    h={}; need_p2=True
if not (h.get('attr') or {}).get('appid'):
    try:
        t=json.load(open(tpl))
        t['projectid']=repo; t['projectpath']=repo; t['projectname']='huangque-miniprogram'
        h=t
    except Exception as e:
        print('no template:', e); raise SystemExit(1)
    need_p2=True
if need_p2:
    open(p2,'w').write(json.dumps(h, ensure_ascii=False, separators=(',',':')))
    print('project2_ 已修复')
else:
    print('project2_ 正常')
d=json.load(open(pl))
rec=d.get(repo)
if not rec or not rec.get('appId'):
    d[repo]={'projectId':repo,'appId':appid,'projectPath':repo,'projectName':'huangque-miniprogram','compileType':'weapp','appImageUrl':'http://wx.qlogo.cn/mmhead/0nn3FBrD9a37MAsNZLibKZSibTEWiaUqz9BdjgEwf9zy1PdWGhF8iaOhDHSoia1J8j0v07ItuzdZGPq0/0','isGame':False,'appName':appname,'appType':0}
    open(pl,'w').write(json.dumps(d, ensure_ascii=False, separators=(',',':')))
    print('projectList 已修复')
else:
    print('projectList 正常')
PYEOF
  log "启动 IDE"
  open -na "$IDE_APP" --args --inspect=9229 --remote-debugging-port=9222
  sleep 30
fi

# ---------- 5. 登录检查 ----------
L=$("$CLI" islogin 2>&1 | tail -3)
echo "$L" | grep -q '"login":true' || fail "IDE 未登录，需要人工扫码登录后重跑"
log "IDE 已登录"

# ---------- 6. 上传 ----------
DESC=$(git -C "$REPO" log -1 --pretty=%s "$HEAD")
DESC=$(python3 -c "import sys;print(sys.argv[1][:80])" "$DESC")
log "上传 v$NEXT: $DESC"
OUT=$("$CLI" upload --project "$REPO" -v "$NEXT" -d "$DESC" -i "/private/tmp/upload-$NEXT.json" 2>&1)
echo "$OUT" | tail -12
if echo "$OUT" | grep -q "✔ upload"; then
  SIZE=$(python3 -c "import json
try:
  d=json.load(open('/private/tmp/upload-$NEXT.json')); print(d['size']['total'])
except Exception: print('')" 2>/dev/null)
  python3 - "$STATE" "$HEAD" "$NEXT" "$DESC" "$SIZE" <<'PYEOF'
import json,sys,datetime
state, commit, ver, desc, size = sys.argv[1:6]
try: d=json.load(open(state))
except Exception: d={}
d.update({'last_published_commit':commit,'last_published_version':ver,'published_desc':desc,'published_at':datetime.datetime.now().isoformat(timespec='seconds'),'package_bytes':int(size) if size else None})
open(state,'w').write(json.dumps(d,ensure_ascii=False,indent=1))
print('状态已更新: %s / v%s / %s bytes' % (commit, ver, size))
PYEOF
  log "发布完成：v$NEXT 已上传并自动成为体验版"
  exit 0
fi
# 版本号撞车重试一次
if echo "$OUT" | grep -qE "已存在|already exist|version.*exist"; then
  NEXT2="${NEXT%.*}.$((${NEXT##*.}+1))"
  log "版本撞车，改用 $NEXT2 重试"
  OUT2=$("$CLI" upload --project "$REPO" -v "$NEXT2" -d "$DESC" -i "/private/tmp/upload-$NEXT2.json" 2>&1)
  echo "$OUT2" | tail -8
  echo "$OUT2" | grep -q "✔ upload" || fail "重试仍失败"
  python3 - "$STATE" "$HEAD" "$NEXT2" "$DESC" <<'PYEOF'
import json,sys,datetime
state, commit, ver, desc = sys.argv[1:5]
try: d=json.load(open(state))
except Exception: d={}
d.update({'last_published_commit':commit,'last_published_version':ver,'published_desc':desc,'published_at':datetime.datetime.now().isoformat(timespec='seconds')})
open(state,'w').write(json.dumps(d,ensure_ascii=False,indent=1))
print('状态已更新: %s / v%s' % (commit, ver))
PYEOF
  log "发布完成：v$NEXT2"
  exit 0
fi
fail "上传失败，详见上方输出"
