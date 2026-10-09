// Format server amounts and compare inputs without floating-point arithmetic.
function units(value, places = 4) {
  const text = String(value == null ? '0' : value);
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw Error('金额格式不正确');
  const parts = text.replace(/^-/, '').split('.');
  return (BigInt(parts[0]) * BigInt('1' + '0'.repeat(places)) +
    BigInt((parts[1] || '').slice(0, places).padEnd(places, '0'))) *
    (text[0] === '-' ? BigInt(-1) : BigInt(1));
}
function money(value) {
  if (value == null) return '待计算';
  const text = String(value), fraction = text.replace(/^-/, '').split('.')[1] || '';
  const cents = units(text.replace(/^-/, ''), 2) + (fraction[2] >= '5' ? BigInt(1) : BigInt(0));
  return (text[0] === '-' && cents !== BigInt(0) ? '-' : '') +
    (cents / BigInt(100)).toString() + '.' + (cents % BigInt(100)).toString().padStart(2, '0');
}
function label(value) { return value == null ? '待计算' : '¥' + money(value); }
function price(value) { if(value == null)return '待计算'; units(value); return '¥'+String(value).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1'); }
module.exports = { units, money, label, price };
