const request = require('./request');
const amount = require('./amount');
const keys = ['total', 'today', 'yesterday'];
function earnings(value) {
  const result = {};
  for (const key of keys) {
    if (!value || typeof value[key] !== 'string' || !/^-?\d+(\.\d{1,4})?$/.test(value[key])) throw new Error('收益数据不完整');
    result[key] = amount.label(value[key]);
  }
  return result;
}
function turnover(value) {
  if (!value) return {total:'暂不可用',today:'—',yesterday:'—',note:'团队流水暂未接通'};
  const result = earnings(value);
  for (const key of keys) {
    if (value.missing[key] > 0) result[key] = value.records[key] === value.missing[key] ? '待补充' : result[key] + '（已统计）';
  }
  result.note = value.missing.total > 0 ? value.missing.total + ' 条业绩缺少上游金额，补齐后自动更新' : '按上游报表金额统计，含本人及团队业绩';
  return result;
}
async function load(user, leaderOnly = false) {
  if (!user || !['leader','creator'].includes(user.role) || leaderOnly && user.role !== 'leader')
    return { memberSummary:null, summaryError:'' };
  try {
    const data = await request.get('/core/member-summary');
    const summary = {direct:earnings(data.direct),businessDate:data.businessDate};
    if (user.role === 'leader') {
      if (!data.team || !Number.isInteger(data.team.memberCount) || data.team.memberCount < 0) throw new Error('团队数据不完整');
      summary.team = {memberCount:data.team.memberCount,reward:earnings(data.team.reward),turnover:turnover(data.team.turnover)};
    }
    return {memberSummary:summary,summaryError:''};
  } catch (_) {
    return {memberSummary:null,summaryError:'收益数据暂时没加载出来，请重试'};
  }
}
module.exports = {load};
