(function (root) {
  "use strict";

  var L = {};
  var TZ = "America/New_York";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  L.DEFAULTS = {
    tab: "all", type: "both", min: 3000, max: 5500, areas: [],
    walk: 0, avail: "any", found: "any", sort: "newest"
  };

  var PRICE_STEPS = [];
  for (var p = 3000; p <= 5500; p += 250) PRICE_STEPS.push(p);

  function copy(s) {
    var o = {};
    for (var k in s) o[k] = s[k];
    o.areas = s.areas.slice();
    return o;
  }

  function has(list, v) { return list.indexOf(v) >= 0; }

  L.normalize = function (rec, source, order) {
    var isUnit = source === "building";
    return {
      source: source,
      beds: rec.beds,
      rent: rec.rent == null ? null : rec.rent,
      area: rec.area || "Unknown",
      walk: rec.walk_min == null ? null : rec.walk_min,
      availNow: isUnit ? (rec.available_now == null ? null : rec.available_now) : null,
      availDate: rec.available || null,
      foundAt: rec.found_at || "",
      order: order || 0,
      rec: rec
    };
  };

  L.availability = function (item, today) {
    if (item.availNow === true) return "now";
    if (item.availDate) return item.availDate <= today ? "now" : item.availDate;
    return null;
  };

  var nyFmt = null;
  L.foundDay = function (item) {
    var rec = item.rec || {};
    if (rec.found_at) {
      var d = new Date(rec.found_at);
      if (!isNaN(d.getTime())) {
        if (!nyFmt) nyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
        return nyFmt.format(d);
      }
    }
    return rec.first_seen || "";
  };

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function lastDayOfMonth(ym) {
    var y = parseInt(ym.slice(0, 4), 10), m = parseInt(ym.slice(5, 7), 10);
    return ym + "-" + pad(new Date(Date.UTC(y, m, 0)).getUTCDate());
  }

  function minusDays(day, n) {
    var d = new Date(day + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - n);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }

  function range(state) {
    return state.min <= state.max ? [state.min, state.max] : [state.max, state.min];
  }

  L.matches = function (item, state, today) {
    if (state.tab === "streeteasy" && item.source !== "streeteasy") return false;
    if (state.tab === "buildings" && item.source !== "building") return false;
    if (state.type === "studio" && item.beds !== 0) return false;
    if (state.type === "1br" && item.beds !== 1) return false;
    var r = range(state);
    if (r[0] !== L.DEFAULTS.min || r[1] !== L.DEFAULTS.max) {
      if (item.rent == null || item.rent < r[0] || item.rent > r[1]) return false;
    }
    if (state.areas.length && !has(state.areas, item.area)) return false;
    if (state.walk) {
      if (item.walk == null || item.walk > state.walk) return false;
    }
    if (state.avail !== "any") {
      var a = L.availability(item, today);
      if (a == null) return false;
      if (state.avail === "now") {
        if (a !== "now") return false;
      } else if (a !== "now" && a > lastDayOfMonth(state.avail)) {
        return false;
      }
    }
    if (state.found !== "any") {
      var f = L.foundDay(item);
      if (!f) return false;
      if (state.found === "today" && f !== today) return false;
      if (state.found === "3d" && f < minusDays(today, 2)) return false;
    }
    return true;
  };

  // Compare nullable values ascending, nulls last.
  function cmpNullable(a, b) {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function cmpNewest(a, b) {
    if (a.foundAt !== b.foundAt) return a.foundAt > b.foundAt ? -1 : 1;
    return a.order - b.order;
  }

  L.sortItems = function (items, sort, today) {
    var key = null;
    if (sort === "cheapest") key = function (i) { return i.rent; };
    else if (sort === "closest") key = function (i) { return i.walk; };
    else if (sort === "soonest") {
      key = function (i) {
        var a = L.availability(i, today);
        return a == null ? null : a === "now" ? "0" : "1" + a;
      };
    }
    return items.slice().sort(function (a, b) {
      if (key) {
        var c = cmpNullable(key(a), key(b));
        if (c) return c;
      }
      return cmpNewest(a, b);
    });
  };

  L.areaCounts = function (items) {
    var map = {}, out = [];
    items.forEach(function (i) { map[i.area] = (map[i.area] || 0) + 1; });
    for (var name in map) out.push({ area: name, n: map[name] });
    out.sort(function (a, b) {
      return b.n - a.n || (a.area < b.area ? -1 : a.area > b.area ? 1 : 0);
    });
    return out;
  };

  var HASH_ORDER = ["tab", "type", "min", "max", "area", "walk", "avail", "found", "sort"];

  L.toHash = function (state) {
    var D = L.DEFAULTS, parts = [];
    HASH_ORDER.forEach(function (k) {
      if (k === "area") {
        if (state.areas.length) parts.push("area=" + encodeURIComponent(state.areas.join(",")));
      } else if (state[k] !== D[k]) {
        parts.push(k + "=" + encodeURIComponent(state[k]));
      }
    });
    return parts.length ? "#" + parts.join("&") : "";
  };

  L.fromHash = function (hash, fallback) {
    var out = copy(fallback);
    var h = String(hash || "").replace(/^#/, "");
    if (!h) return out;
    if (h === "buildings" || h === "streeteasy") {
      out.tab = h;
      return out;
    }
    var raw = {};
    h.split("&").forEach(function (pair) {
      var i = pair.indexOf("=");
      if (i < 0) return;
      try {
        raw[pair.slice(0, i)] = decodeURIComponent(pair.slice(i + 1));
      } catch (e) { /* malformed escape: ignore this field */ }
    });
    if (has(["all", "streeteasy", "buildings"], raw.tab)) out.tab = raw.tab;
    if (has(["both", "studio", "1br"], raw.type)) out.type = raw.type;
    ["min", "max"].forEach(function (k) {
      if (raw[k] != null && /^\d+$/.test(raw[k]) && has(PRICE_STEPS, +raw[k])) out[k] = +raw[k];
    });
    if (raw.walk != null && has(["0", "10", "15", "20"], raw.walk)) out.walk = +raw.walk;
    if (raw.avail != null && /^(any|now|\d{4}-\d{2})$/.test(raw.avail)) out.avail = raw.avail;
    if (has(["any", "today", "3d"], raw.found)) out.found = raw.found;
    if (has(["newest", "cheapest", "closest", "soonest"], raw.sort)) out.sort = raw.sort;
    if (raw.area != null) {
      var names = raw.area.split(",").filter(function (n) { return n; });
      if (names.length) out.areas = names;
    }
    return out;
  };

  // Hash alone decides the view, except for a bare URL or the legacy
  // #buildings / #streeteasy links, which keep the visitor's saved filters.
  L.initialState = function (hash, saved) {
    var h = String(hash || "").replace(/^#/, "");
    var keepSaved = !h || h === "buildings" || h === "streeteasy";
    return L.fromHash(hash, keepSaved && saved ? saved : L.DEFAULTS);
  };

  function money(n) {
    return "$" + String(n).replace(/\B(?=(\d{3})+$)/g, ",");
  }

  L.activeChips = function (state) {
    var D = L.DEFAULTS, chips = [];
    if (state.type !== D.type) {
      chips.push({ key: "type", label: state.type === "studio" ? "Studio" : "1BR" });
    }
    if (state.min !== D.min || state.max !== D.max) {
      var r = range(state);
      chips.push({ key: "price", label: money(r[0]) + "–" + money(r[1]) });
    }
    state.areas.forEach(function (a) { chips.push({ key: "area:" + a, label: a }); });
    if (state.walk !== D.walk) {
      chips.push({ key: "walk", label: "≤" + state.walk + " min walk" });
    }
    if (state.avail !== D.avail) {
      var label = "Available now";
      if (state.avail !== "now") {
        label = "By " + MONTHS[parseInt(state.avail.slice(5, 7), 10) - 1] + " " + state.avail.slice(0, 4);
      }
      chips.push({ key: "avail", label: label });
    }
    if (state.found !== D.found) {
      chips.push({ key: "found", label: state.found === "today" ? "Found today" : "Last 3 days" });
    }
    return chips;
  };

  L.clearFilters = function (state) {
    var out = copy(L.DEFAULTS);
    out.tab = state.tab;
    out.sort = state.sort;
    return out;
  };

  if (typeof module === "object" && module.exports) module.exports = L;
  else root.FeedLogic = L;
})(this);
