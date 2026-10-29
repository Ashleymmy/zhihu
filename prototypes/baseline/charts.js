/* TIMO Web Demo — 轻量 SVG 图表（无依赖） */
(function () {
  'use strict';
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function nice(max) {
    if (!(max > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(max))), n = max / p;
    var s = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return s * p;
  }
  function short(v) {
    var a = Math.abs(v);
    if (a >= 10000) return (v / 10000).toFixed(a >= 100000 ? 0 : 1) + '万';
    if (a >= 1000) return (v / 1000).toFixed(1) + 'k';
    return String(Math.round(v * 100) / 100);
  }
  var uid = 0;

  function axes(o, W, H, pl, pr, pt, pb, max, n, xAt) {
    var g = '', ih = H - pt - pb;
    for (var k = 0; k <= 4; k++) {
      var v = max * k / 4, yy = pt + ih - (v / max) * ih;
      g += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + yy + '" y2="' + yy + '" class="ch-grid"/>' +
        '<text x="' + (pl - 8) + '" y="' + (yy + 4) + '" class="ch-ax" text-anchor="end">' + (o.yFmt || short)(v) + '</text>';
    }
    var step = Math.max(1, Math.ceil(n / (o.xTicks || 7)));
    for (var i = 0; i < n; i += step) g += '<text x="' + xAt(i) + '" y="' + (H - 6) + '" class="ch-ax" text-anchor="middle">' + o.labels[i] + '</text>';
    return g;
  }
  function tipHtml(label, rows, fmt) {
    return '<b>' + label + '</b>' + rows.map(function (r) {
      return '<div><i style="background:' + r.color + '"></i>' + r.name + '<span>' + (fmt || short)(r.v) + '</span></div>';
    }).join('');
  }

  function line(o) {
    var W = o.w || 640, H = o.h || 220, pl = 46, pr = 14, pt = 12, pb = 26;
    var n = o.labels.length, max = 0;
    o.series.forEach(function (s) { s.values.forEach(function (v) { if (v > max) max = v; }); });
    max = nice(max * 1.08);
    var iw = W - pl - pr, ih = H - pt - pb;
    function x(i) { return pl + (n <= 1 ? iw / 2 : i * iw / (n - 1)); }
    function y(v) { return pt + ih - (v / max) * ih; }
    var out = axes(o, W, H, pl, pr, pt, pb, max, n, x);
    o.series.forEach(function (s) {
      var d = s.values.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join('');
      if (s.area) {
        var id = 'lg' + (++uid);
        out += '<defs><linearGradient id="' + id + '" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="' + s.color + '" stop-opacity=".26"/><stop offset="1" stop-color="' + s.color + '" stop-opacity="0"/></linearGradient></defs>' +
          '<path d="' + d + 'L' + x(n - 1) + ' ' + (pt + ih) + 'L' + x(0) + ' ' + (pt + ih) + 'Z" fill="url(#' + id + ')"/>';
      }
      out += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"' + (s.dash ? ' stroke-dasharray="5 5"' : '') + '/>';
    });
    var cw = iw / Math.max(1, n - 1);
    for (var i = 0; i < n; i++) {
      var tip = tipHtml(o.labels[i], o.series.map(function (s) { return { name: s.name, color: s.color, v: s.values[i] }; }), o.fmt);
      out += '<rect class="ch-hov" x="' + (x(i) - cw / 2) + '" y="' + pt + '" width="' + cw + '" height="' + ih + '" data-tip="' + esc(tip) + '"/>';
    }
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" width="100%">' + out + '</svg>';
  }

  function bars(o) {
    var W = o.w || 640, H = o.h || 220, pl = 46, pr = 14, pt = 12, pb = 26;
    var n = o.labels.length, max = 0;
    for (var i = 0; i < n; i++) {
      var t = 0; o.series.forEach(function (s) { t += s.values[i] || 0; });
      if (t > max) max = t;
    }
    max = nice(max * 1.08);
    var iw = W - pl - pr, ih = H - pt - pb, slot = iw / n, bw = Math.min(28, slot * 0.62);
    function cx(i) { return pl + slot * i + slot / 2; }
    var out = axes(o, W, H, pl, pr, pt, pb, max, n, cx);
    for (var j = 0; j < n; j++) {
      var acc = 0;
      o.series.forEach(function (s, si) {
        var v = s.values[j] || 0, h = v / max * ih;
        if (h <= 0) return;
        var last = si === o.series.length - 1;
        out += '<rect x="' + (cx(j) - bw / 2) + '" y="' + (pt + ih - acc - h) + '" width="' + bw + '" height="' + Math.max(0.5, h - (last ? 0 : 1)) + '" rx="' + (last ? 3 : 1) + '" fill="' + s.color + '"/>';
        acc += h;
      });
      var tip = tipHtml(o.labels[j], o.series.map(function (s) { return { name: s.name, color: s.color, v: s.values[j] || 0 }; }), o.fmt);
      out += '<rect class="ch-hov" x="' + (pl + slot * j) + '" y="' + pt + '" width="' + slot + '" height="' + ih + '" data-tip="' + esc(tip) + '"/>';
    }
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" width="100%">' + out + '</svg>';
  }

  function hbars(items, fmt) {
    var max = 0; items.forEach(function (it) { if (it.value > max) max = it.value; });
    return '<div class="hb">' + items.map(function (it) {
      return '<div class="hb-row"><span class="hb-l">' + it.label + '</span><div class="hb-t"><i style="width:' + (max ? (it.value / max * 100).toFixed(1) : 0) + '%;background:' + (it.color || 'var(--primary)') + '"></i></div><span class="hb-v num">' + (fmt || short)(it.value) + '</span></div>';
    }).join('') + '</div>';
  }

  function donut(o) {
    var size = o.size || 180, th = o.thickness || 20, r = (size - th) / 2, c = 2 * Math.PI * r;
    var total = 0; o.items.forEach(function (it) { total += it.value; });
    var acc = 0, segs = '';
    o.items.forEach(function (it) {
      var len = total ? it.value / total * c : 0;
      if (len <= 0) return;
      var gap = o.items.length > 1 ? Math.min(2, len / 2) : 0;
      segs += '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + it.color + '" stroke-width="' + th + '" stroke-dasharray="' + (len - gap).toFixed(2) + ' ' + (c - len + gap).toFixed(2) + '" stroke-dashoffset="' + (-acc).toFixed(2) + '" class="ch-seg" data-tip="' + esc('<b>' + it.label + '</b><div><i style="background:' + it.color + '"></i>占比<span>' + (total ? (it.value / total * 100).toFixed(1) : 0) + '%</span></div>') + '"/>';
      acc += len;
    });
    return '<div class="donut" style="width:' + size + 'px;height:' + size + 'px"><svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" style="transform:rotate(-90deg)"><circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" class="ch-track" stroke-width="' + th + '"/>' + segs + '</svg>' +
      (o.center ? '<div class="donut-c"><b class="num">' + o.center.value + '</b><small>' + o.center.label + '</small></div>' : '') + '</div>';
  }

  function legend(items, fmt) {
    var total = 0; items.forEach(function (it) { total += it.value; });
    return '<ul class="legend">' + items.map(function (it) {
      return '<li><i style="background:' + it.color + '"></i><span>' + it.label + '</span><b class="num">' + (fmt ? fmt(it.value) : short(it.value)) + '</b><em>' + (total ? (it.value / total * 100).toFixed(1) : 0) + '%</em></li>';
    }).join('') + '</ul>';
  }

  function sankey(o) {
    var W = o.w || 760, H = o.h || 320, nw = 12, pl = o.pl || 96, pr = o.pr || 150, gap = 12, pt = 6;
    var lv = {}, rv = {};
    o.links.forEach(function (l) { lv[l.s] = (lv[l.s] || 0) + l.v; rv[l.t] = (rv[l.t] || 0) + l.v; });
    var left = o.left.filter(function (n) { return lv[n.id] > 0; }), right = o.right.filter(function (n) { return rv[n.id] > 0; });
    var total = 0; left.forEach(function (n) { total += lv[n.id]; });
    var scaleL = (H - pt * 2 - gap * (left.length - 1)) / total, scaleR = (H - pt * 2 - gap * (right.length - 1)) / total, sc = Math.min(scaleL, scaleR);
    var ly = {}, ry = {}, y = pt + (H - pt * 2 - gap * (left.length - 1) - total * sc) / 2, out = '', fmt = o.fmt || short;
    var lx = pl, rx = W - pr - nw;
    left.forEach(function (n) { ly[n.id] = { y: y, off: 0, h: lv[n.id] * sc, n: n }; y += lv[n.id] * sc + gap; });
    y = pt + (H - pt * 2 - gap * (right.length - 1) - total * sc) / 2;
    right.forEach(function (n) { ry[n.id] = { y: y, off: 0, h: rv[n.id] * sc, n: n }; y += rv[n.id] * sc + gap; });
    o.links.forEach(function (l) {
      var s = ly[l.s], t = ry[l.t]; if (!s || !t || l.v <= 0) return;
      var h = l.v * sc, sy0 = s.y + s.off, ty0 = t.y + t.off, x0 = lx + nw, x1 = rx, mx = (x0 + x1) / 2;
      s.off += h; t.off += h;
      out += '<path class="sk-link" d="M' + x0 + ' ' + sy0 + 'C' + mx + ' ' + sy0 + ' ' + mx + ' ' + ty0 + ' ' + x1 + ' ' + ty0 + 'L' + x1 + ' ' + (ty0 + h) + 'C' + mx + ' ' + (ty0 + h) + ' ' + mx + ' ' + (sy0 + h) + ' ' + x0 + ' ' + (sy0 + h) + 'Z" fill="' + s.n.color + '" data-tip="' + esc('<b>' + s.n.label + ' → ' + t.n.label + '</b><div><i style="background:' + s.n.color + '"></i>金额<span>' + fmt(l.v) + '</span></div>') + '"/>';
    });
    left.forEach(function (n) { var s = ly[n.id]; out += '<rect x="' + lx + '" y="' + s.y + '" width="' + nw + '" height="' + Math.max(1, s.h) + '" rx="3" fill="' + n.color + '"/><text x="' + (lx - 8) + '" y="' + (s.y + s.h / 2 - 2) + '" text-anchor="end" class="sk-t">' + n.label + '</text><text x="' + (lx - 8) + '" y="' + (s.y + s.h / 2 + 13) + '" text-anchor="end" class="sk-v">' + fmt(lv[n.id]) + '</text>'; });
    right.forEach(function (n) { var t = ry[n.id]; out += '<rect x="' + rx + '" y="' + t.y + '" width="' + nw + '" height="' + Math.max(1, t.h) + '" rx="3" fill="' + n.color + '"/><text x="' + (rx + nw + 8) + '" y="' + (t.y + t.h / 2 - 2) + '" class="sk-t">' + n.label + '</text><text x="' + (rx + nw + 8) + '" y="' + (t.y + t.h / 2 + 13) + '" class="sk-v">' + fmt(rv[n.id]) + ' · ' + (rv[n.id] / total * 100).toFixed(1) + '%</text>'; });
    return '<svg class="chart sankey" viewBox="0 0 ' + W + ' ' + H + '" width="100%">' + out + '</svg>';
  }

  function spark(values, color, w, h) {
    w = w || 120; h = h || 34;
    var max = Math.max.apply(null, values.concat([1])), min = Math.min.apply(null, values.concat([0]));
    var n = values.length;
    var d = values.map(function (v, i) { return (i ? 'L' : 'M') + (i * w / (n - 1)).toFixed(1) + ' ' + (h - 3 - (v - min) / (max - min || 1) * (h - 6)).toFixed(1); }).join('');
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" class="spark"><path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function ring(p, color, size) {
    size = size || 44; var th = 5, r = (size - th) / 2, c = 2 * Math.PI * r;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" style="transform:rotate(-90deg)"><circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" class="ch-track" stroke-width="' + th + '"/><circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="' + th + '" stroke-linecap="round" stroke-dasharray="' + (c * p).toFixed(2) + ' ' + c.toFixed(2) + '"/></svg>';
  }

  window.Charts = { line: line, bars: bars, hbars: hbars, donut: donut, legend: legend, sankey: sankey, spark: spark, ring: ring, short: short };
})();

