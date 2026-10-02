function stop(page) {
  clearInterval(page._smsTimer);
  page._smsTimer = null;
}
function start(page) {
  stop(page);
  const tick = () => {
    const cooldown = Math.max(
      0,
      Math.ceil(((page._smsRetryAt || 0) - Date.now()) / 1000),
    );
    page.setData({ cooldown });
    if (!cooldown) stop(page);
  };
  tick();
  if (page.data.cooldown) page._smsTimer = setInterval(tick, 1000);
}
function sent(page, result) {
  page._smsRetryAt =
    Date.now() + Math.max(60, Number(result.retryAfterSeconds) || 60) * 1000;
  start(page);
}
module.exports = { start, stop, sent };
