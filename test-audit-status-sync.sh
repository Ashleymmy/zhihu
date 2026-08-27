#!/bin/bash
# 知乎审核状态同步功能测试脚本

echo "======================================"
echo "知乎审核状态同步功能测试"
echo "======================================"
echo ""

# 配置
ADMIN_TOKEN="${ADMIN_TOKEN:-YOUR_ADMIN_TOKEN_HERE}"
BASE_URL="${BASE_URL:-http://localhost:3000}"

echo "1. 测试推广计划审核状态同步"
echo "发送 POST 请求到 /api/v1/admin-tools/sync-plan-status"
response=$(curl -s -X POST "$BASE_URL/api/v1/admin-tools/sync-plan-status" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json")

if echo "$response" | grep -q "jobId"; then
  echo "✓ 推广计划审核状态同步任务已入队"
  echo "$response" | jq '.'
else
  echo "✗ 推广计划审核状态同步失败"
  echo "$response"
fi

echo ""
echo "2. 测试作品审核状态同步"
echo "发送 POST 请求到 /api/v1/admin-tools/sync-composition-status"
response=$(curl -s -X POST "$BASE_URL/api/v1/admin-tools/sync-composition-status" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json")

if echo "$response" | grep -q "jobId"; then
  echo "✓ 作品审核状态同步任务已入队"
  echo "$response" | jq '.'
else
  echo "✗ 作品审核状态同步失败"
  echo "$response"
fi

echo ""
echo "3. 等待 10 秒让任务执行..."
sleep 10

echo ""
echo "4. 查询推广计划列表，检查审核状态字段"
response=$(curl -s "$BASE_URL/api/v1/plans?page=1&pageSize=5" \
  -H "Authorization: Bearer $ADMIN_TOKEN")

if echo "$response" | grep -q "zhihuStatusJson"; then
  echo "✓ 推广计划列表包含 zhihuStatusJson 字段"
  echo "$response" | jq '.list[0] | {id, keyword, zhihuStatusJson}'
else
  echo "⚠ 推广计划列表暂无 zhihuStatusJson 数据（可能是数据还在同步中）"
fi

echo ""
echo "======================================"
echo "测试完成"
echo "======================================"
echo ""
echo "提示："
echo "1. 如果看到 401 错误，请设置有效的 ADMIN_TOKEN"
echo "2. 如果 zhihuStatusJson 为空，等待几分钟后再次查询"
echo "3. 可以在管理员后台查看图形化界面效果"
