#!/usr/bin/env bash
# Creates the project's issue labels. Safe to re-run: --force updates labels
# that already exist. Needs a logged-in gh inside this repo.
set -euo pipefail

create() { gh label create "$1" --color "$2" --description "$3" --force; }

# type
create "feature"          "1d76db" "新功能"
create "bug"              "d73a4a" "錯誤"
create "chore"            "cfd3d7" "雜務、維護"
create "docs"             "0075ca" "文件"
# area
create "area:generation"  "5319e7" "行程生成主流程、prompt、驗證"
create "area:scheduler"   "5319e7" "規則引擎排程（src/lib/scheduler）"
create "area:places"      "5319e7" "Google Places / Routes、快取、補資料"
create "area:restructure" "5319e7" "重新規劃行程精靈"
create "area:editing"     "5319e7" "單日編輯、重新生成、候選"
create "area:auth"        "5319e7" "登入、訪客、額度、限流"
create "area:ui"          "5319e7" "前端畫面與互動"
# priority
create "p0"               "b60205" "最優先"
create "p1"               "d93f0b" "高"
create "p2"               "fbca04" "一般"
# special
create "plan"             "0e8a16" "對應 docs/plans 的父 issue"
create "cost"             "f9a825" "影響 Google / OpenAI 花費"
create "later"            "ededed" "暫緩，之後再做"
create "blocked"          "e99695" "被卡住"
create "needs-decision"   "f9d0c4" "等使用者拍板"
create "wontfix"          "ffffff" "決定不做"
create "known-limitation" "c5def5" "已知限制（見對應功能頁）"
