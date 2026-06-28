#!/bin/bash
# 牛马助手全维度自动化测试
# 运行: bash tests/run_tests.sh

TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)
REPORT="tests/reports/test_${TIMESTAMP}.md"
mkdir -p tests/reports

echo "# 牛马助手 测试报告" > "$REPORT"
echo "**时间**: $(date '+%Y-%m-%d %H:%M:%S')" >> "$REPORT"
echo "**环境**: $(python3 --version)" >> "$REPORT"
echo "" >> "$REPORT"

run_suite() {
  local name="$1"
  local file="$2"
  local extra="${3:-}"
  echo "## $name" >> "$REPORT"
  echo '```' >> "$REPORT"
  python3 -m pytest "$file" -v --tb=short $extra 2>&1 | tee -a "$REPORT"
  echo '```' >> "$REPORT"
  echo "" >> "$REPORT"
  echo "---" >> "$REPORT"
  echo "" >> "$REPORT"
}

echo "========================================="
echo "  牛马助手 全维度测试"
echo "  报告: $REPORT"
echo "========================================="

# 1. 功能测试
run_suite "1. 功能测试 (API)" "tests/test_api.py"

# 2. 性能/压力测试
run_suite "2. 性能压力测试" "tests/test_perf.py"

# 3. 安全测试
run_suite "3. 安全测试" "tests/test_security.py"

echo ""
echo "========================================="
echo "  测试完成"
echo "  报告: $REPORT"
echo "========================================="
