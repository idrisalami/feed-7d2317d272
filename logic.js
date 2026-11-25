(function (root) {
  "use strict";

  var L = {};
  var TZ = "America/New_York";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  L.DEFAULTS = {
    tab: "all", type: "both", min: 3000, max: 5500, areas: [],
    walk: 0, avail: "any", found: "any", status: "any", sort: "newest"
  };

  var PRICE_STEPS = [];
  for (var p = 3000; p <= 5500; p += 250) PRICE_STEPS.push(p);

  function copy(s) {
    var o = {};
    for (var k in s) o[k] = s[k];
    for (var d in L.DEFAULTS) if (o[d] === undefined) o[d] = L.DEFAULTS[d];
    o.areas = (o.areas || []).slice();
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
    if (state.status && state.status !== "any" && L.stateOf(item) !== state.status) return false;
    return true;
  };

  // ---- Unit status (statuses.json) ----

  L.STATES = ["contacted", "tour_requested", "tour_booked", "visited", "applied", "dropped"];
  L.STATUS_LABELS = {
    contacted: "Contacted", tour_requested: "Tour requested", tour_booked: "Tour booked",
    visited: "Visited", applied: "Applied", dropped: "Dropped"
  };

  var ORDINALS = {
    first: "1", second: "2", third: "3", fourth: "4", fifth: "5", sixth: "6",
    seventh: "7", eighth: "8", ninth: "9", tenth: "10", eleventh: "11", twelfth: "12"
  };
  var STREET_WORDS = {
    west: "w", east: "e", north: "n", south: "s",
    street: "st", avenue: "ave", av: "ave"
  };

  // "110 Ninth Avenue #3Z" and "110 9th Ave" -> "110 9 ave".
  L.streetKey = function (address) {
    var s = String(address || "").toLowerCase().split("#")[0].split(",")[0].replace(/\./g, " ");
    return s.split(/\s+/).filter(function (t) { return t; }).map(function (t) {
      if (ORDINALS[t]) return ORDINALS[t];
      if (STREET_WORDS[t]) return STREET_WORDS[t];
      var m = /^(\d+)(st|nd|rd|th)$/.exec(t);
      return m ? m[1] : t;
    }).join(" ");
  };

  // "N07J" -> "n7j", "225-1R" -> "2251r".
  L.unitKey = function (s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(^|[^0-9])0+(?=[0-9])/g, "$1");
  };

  L.buildingId = function (rec) {
    var m = /^\/building\/([^\/?#]+)/.exec(String((rec && rec.path) || ""));
    return m ? m[1] : null;
  };

  L.listingUnit = function (rec) {
    var addr = String((rec && rec.address) || ""), i = addr.indexOf("#");
    if (i >= 0) return L.unitKey(addr.slice(i + 1).split(/\s/)[0]);
    var parts = String((rec && rec.path) || "").split("/").filter(function (p) { return p; });
    if (parts.length === 3 && parts[0] === "building") return L.unitKey(parts[2]);
    return "";
  };

  function sameBuilding(entry, id, street) {
    if (!entry || typeof entry !== "object") return false;
    if (id && entry.building && entry.building === id) return true;
    return !!(street && entry.address && L.streetKey(entry.address) === street);
  }

  L.statusFor = function (rec, statuses) {
    var out = { unit: null, building: null, siblings: [] };
    if (!statuses || typeof statuses !== "object") return out;
    var units = Array.isArray(statuses.units) ? statuses.units : [];
    var buildings = Array.isArray(statuses.buildings) ? statuses.buildings : [];
    var id = L.buildingId(rec), street = L.streetKey(rec && rec.address), u = L.listingUnit(rec);
    units.forEach(function (e) {
      if (!sameBuilding(e, id, street)) return;
      if (u && !out.unit && L.unitKey(e.unit) === u) out.unit = e;
      else if (!u || L.unitKey(e.unit) !== u) out.siblings.push(e);
    });
    for (var i = 0; i < buildings.length; i++) {
      if (sameBuilding(buildings[i], id, street)) { out.building = buildings[i]; break; }
    }
    return out;
  };

  // Siblings worth a line on the card: when the whole building is dropped, its dropped units add nothing.
  L.shownSiblings = function (st) {
    var sib = (st && Array.isArray(st.siblings)) ? st.siblings : [];
    if (!(st && st.building && st.building.state === "dropped")) return sib;
    return sib.filter(function (s) { return s.state !== "dropped"; });
  };

  L.stateOf = function (item) {
    var st = item && item.st;
    if (!st) return "none";
    if (st.unit && st.unit.state) return st.unit.state;
    if (st.building && st.building.state === "dropped") return "dropped";
    return "none";
  };

  function isDropped(item) { return L.stateOf(item) === "dropped"; }

  // "Sat, Nov 28, 12:15" / "Sun, Nov 29"; formatted in UTC so no timezone shifts the day.
  L.statusWhen = function (s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String((s && s.date) || ""));
    if (!m) return "";
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    var out = d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
    return s.time ? out + ", " + s.time : out;
  };

  // The colored strip on top of a StreetEasy card: {state, label, when, lines} or null.
  // state is a STATES key, or "building" for a neutral "Same building" strip.
  L.stripFor = function (st) {
    if (!st) return null;
    function day(s) { return L.statusWhen({ date: s.date }); }
    function short(s) { return "#" + s.unit + " " + (L.STATUS_LABELS[s.state] || s.state).toLowerCase() + " · " + day(s); }
    var us = st.unit, b = st.building, sib = L.shownSiblings(st), lines = [];
    if (us) {
      return { state: us.state, label: L.STATUS_LABELS[us.state] || us.state,
        when: day(us) + (us.time ? " · " + us.time : ""),
        lines: Array.isArray(us.notes) ? us.notes.slice() : [] };
    }
    sib.slice(0, 2).forEach(function (s) { lines.push(short(s)); });
    if (sib.length > 2) lines.push("+" + (sib.length - 2) + " more");
    if (b && b.state === "dropped") return { state: "dropped", label: "Building dropped", when: day(b), lines: lines };
    var repeat = b && sib.some(function (s) { return s.state === b.state && s.date === b.date; });
    if (b && !repeat) lines.push(b.name + " " + (L.STATUS_LABELS[b.state] || b.state).toLowerCase() + " · " + day(b));
    if (!lines.length) return null;
    return { state: "building", label: "Same building", when: lines[0], lines: lines.slice(1) };
  };

  L.statusCounts = function (items) {
    var c = {};
    items.forEach(function (i) { var k = L.stateOf(i); c[k] = (c[k] || 0) + 1; });
    return c;
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
      var da = isDropped(a), db = isDropped(b);
      if (da !== db) return da ? 1 : -1;
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

  var HASH_ORDER = ["tab", "type", "min", "max", "area", "walk", "avail", "found", "status", "sort"];

  L.toHash = function (state) {
    var D = L.DEFAULTS, parts = [];
    HASH_ORDER.forEach(function (k) {
      if (k === "area") {
        if (state.areas.length) parts.push("area=" + encodeURIComponent(state.areas.join(",")));
      } else if (state[k] !== undefined && state[k] !== D[k]) {
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
    if (raw.status === "any" || raw.status === "none" || has(L.STATES, raw.status)) out.status = raw.status;
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
    if (state.status && state.status !== D.status) {
      chips.push({ key: "status", label: state.status === "none" ? "Not contacted" : (L.STATUS_LABELS[state.status] || state.status) });
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
