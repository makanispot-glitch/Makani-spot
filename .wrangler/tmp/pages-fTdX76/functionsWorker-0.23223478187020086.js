var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// admin/auth.js
async function onRequestPost(context) {
  try {
    const { password } = await context.request.json();
    const ADM_PASSWORD = context.env.ADM_PASSWORD;
    const ADM_SECRET = context.env.ADM_SECRET;
    if (!ADM_PASSWORD || !ADM_SECRET || password !== ADM_PASSWORD) {
      return json({ error: "Unauthorized" }, 401);
    }
    const exp = Date.now() + 8 * 60 * 60 * 1e3;
    const payload = btoa(JSON.stringify({ exp }));
    const hmac = await sign(payload, ADM_SECRET);
    const token = `${payload}.${hmac}`;
    return json({ token }, 200);
  } catch {
    return json({ error: "Bad request" }, 400);
  }
}
__name(onRequestPost, "onRequestPost");
async function sign(data, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
__name(sign, "sign");
function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
__name(json, "json");

// admin/listings.js
async function onRequest(context) {
  try {
    const ADM_SECRET = context.env.ADM_SECRET;
    const SUPABASE_URL = context.env.SUPABASE_URL;
    const SERVICE_KEY = context.env.SUPABASE_SERVICE_KEY;
    if (!SUPABASE_URL || !SERVICE_KEY || !ADM_SECRET) {
      return json2({ error: "Server misconfigured: missing env vars (SUPABASE_URL / SUPABASE_SERVICE_KEY / ADM_SECRET)" }, 500);
    }
    const auth = context.request.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!await validateToken(token, ADM_SECRET)) {
      return json2({ error: "Unauthorized" }, 401);
    }
    const sbHeaders = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "apikey": SERVICE_KEY,
      "Prefer": "return=minimal"
    };
    const method = context.request.method;
    if (method === "GET") {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/listings?status=neq.deleted&order=created_at.desc&select=*`,
        { headers: sbHeaders }
      );
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (method === "PATCH") {
      let body;
      try {
        body = await context.request.json();
      } catch {
        return json2({ error: "Invalid JSON body" }, 400);
      }
      const { id, ...updates } = body;
      if (!id) return json2({ error: "Missing listing id" }, 400);
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/listings?id=eq.${encodeURIComponent(id)}`,
        { method: "PATCH", headers: sbHeaders, body: JSON.stringify(updates) }
      );
      const text = await res.text();
      if (!res.ok) {
        let errMsg;
        try {
          errMsg = JSON.parse(text);
        } catch {
          errMsg = { error: text };
        }
        return json2(errMsg, res.status);
      }
      return new Response(text || "{}", {
        status: res.status,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (method === "DELETE") {
      let body;
      try {
        body = await context.request.json();
      } catch {
        return json2({ error: "Invalid JSON body" }, 400);
      }
      const { id } = body;
      if (!id) return json2({ error: "Missing listing id" }, 400);
      const getRes = await fetch(
        `${SUPABASE_URL}/rest/v1/listings?id=eq.${encodeURIComponent(id)}&select=cover_image,images`,
        { headers: sbHeaders }
      );
      let listing = null;
      try {
        const arr = await getRes.json();
        listing = arr && arr[0];
      } catch {
      }
      const bucket = context.env.BUCKET || context.env["BUCKET-1"];
      if (bucket && listing) {
        const R2_BASE = "https://pub-df88163958eb4109a8f8f3b9c62a2d3e.r2.dev/";
        const allUrls = [listing.cover_image, ...listing.images || []].filter(Boolean);
        for (const url of allUrls) {
          if (typeof url === "string" && url.startsWith(R2_BASE)) {
            const path = url.slice(R2_BASE.length);
            try {
              await bucket.delete(path);
            } catch {
            }
            if (path.endsWith("_f.webp")) {
              try {
                await bucket.delete(path.replace("_f.webp", "_c.webp"));
              } catch {
              }
              try {
                await bucket.delete(path.replace("_f.webp", "_d.webp"));
              } catch {
              }
            }
          }
        }
      }
      const delRes = await fetch(
        `${SUPABASE_URL}/rest/v1/listings?id=eq.${encodeURIComponent(id)}`,
        { method: "DELETE", headers: sbHeaders }
      );
      if (!delRes.ok) {
        const errText = await delRes.text();
        let errMsg;
        try {
          errMsg = JSON.parse(errText);
        } catch {
          errMsg = { error: errText };
        }
        return json2(errMsg, delRes.status);
      }
      return json2({ ok: true }, 200);
    }
    return json2({ error: "Method not allowed" }, 405);
  } catch (e) {
    return json2({ error: e.message || "Internal server error" }, 500);
  }
}
__name(onRequest, "onRequest");
async function validateToken(token, secret) {
  try {
    const dot = token.lastIndexOf(".");
    if (dot < 0) return false;
    const payload = token.slice(0, dot);
    const hmac = token.slice(dot + 1);
    const { exp } = JSON.parse(atob(payload));
    if (!exp || Date.now() > exp) return false;
    const expected = await sign2(payload, secret);
    return hmac === expected;
  } catch {
    return false;
  }
}
__name(validateToken, "validateToken");
async function sign2(data, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
__name(sign2, "sign");
function json2(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
__name(json2, "json");

// delete-listing.js
var R2_PUBLIC_BASE = "https://pub-df88163958eb4109a8f8f3b9c62a2d3e.r2.dev/";
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type"
};
async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
__name(onRequestOptions, "onRequestOptions");
async function onRequestDelete(context) {
  const { request, env } = context;
  const SUPABASE_URL = env.SUPABASE_URL;
  const SERVICE_KEY = env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return fail(503, "Server misconfigured");
  }
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return fail(401, "\u063A\u064A\u0631 \u0645\u0635\u0631\u0651\u062D \u2014 \u064A\u062C\u0628 \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644");
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${token}` }
  });
  if (!userRes.ok) return fail(401, "\u062C\u0644\u0633\u0629 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629 \u2014 \u0633\u062C\u0651\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0645\u062C\u062F\u062F\u0627\u064B");
  const userData = await userRes.json();
  const userId = userData?.id;
  if (!userId) return fail(401, "\u062A\u0639\u0630\u0631 \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0647\u0648\u064A\u062A\u0643");
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "\u0628\u064A\u0627\u0646\u0627\u062A \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629");
  }
  const { id } = body;
  if (!id) return fail(400, "\u0645\u0639\u0631\u0651\u0641 \u0627\u0644\u0625\u0639\u0644\u0627\u0646 \u0645\u0637\u0644\u0648\u0628");
  const sbHeaders = {
    "apikey": SERVICE_KEY,
    "Authorization": `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json"
  };
  const getRes = await fetch(
    `${SUPABASE_URL}/rest/v1/listings?id=eq.${encodeURIComponent(id)}&select=user_id,cover_image,images`,
    { headers: sbHeaders }
  );
  let listing = null;
  try {
    const arr = await getRes.json();
    listing = arr && arr[0];
  } catch {
  }
  if (!listing) return fail(404, "\u0627\u0644\u0625\u0639\u0644\u0627\u0646 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F");
  if (listing.user_id !== userId) return fail(403, "\u0644\u064A\u0633 \u0644\u062F\u064A\u0643 \u0635\u0644\u0627\u062D\u064A\u0629 \u062D\u0630\u0641 \u0647\u0630\u0627 \u0627\u0644\u0625\u0639\u0644\u0627\u0646");
  const bucket = env.BUCKET || env["BUCKET-1"];
  if (bucket) {
    const allUrls = [listing.cover_image, ...listing.images || []].filter(Boolean);
    for (const url of allUrls) {
      if (typeof url === "string" && url.startsWith(R2_PUBLIC_BASE)) {
        const path = url.slice(R2_PUBLIC_BASE.length);
        try {
          await bucket.delete(path);
        } catch {
        }
        if (path.endsWith("_f.webp")) {
          try {
            await bucket.delete(path.replace("_f.webp", "_c.webp"));
          } catch {
          }
          try {
            await bucket.delete(path.replace("_f.webp", "_d.webp"));
          } catch {
          }
        }
      }
    }
  }
  const delRes = await fetch(
    `${SUPABASE_URL}/rest/v1/listings?id=eq.${encodeURIComponent(id)}`,
    { method: "DELETE", headers: { ...sbHeaders, "Prefer": "return=minimal" } }
  );
  if (!delRes.ok) {
    const errText = await delRes.text();
    return fail(500, "\u0641\u0634\u0644 \u062D\u0630\u0641 \u0627\u0644\u0625\u0639\u0644\u0627\u0646 \u0645\u0646 \u0642\u0627\u0639\u062F\u0629 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A: " + errText);
  }
  return ok({ ok: true });
}
__name(onRequestDelete, "onRequestDelete");
function ok(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" }
  });
}
__name(ok, "ok");
function fail(status, error) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" }
  });
}
__name(fail, "fail");

// upload.js
var R2_PUBLIC_BASE2 = "https://pub-df88163958eb4109a8f8f3b9c62a2d3e.r2.dev";
var CORS2 = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type"
};
async function onRequestOptions2() {
  return new Response(null, { status: 204, headers: CORS2 });
}
__name(onRequestOptions2, "onRequestOptions");
async function onRequestPost2(context) {
  const { request, env } = context;
  const bucket = env.BUCKET || env["BUCKET-1"];
  if (!bucket) {
    return fail2(503, "R2 bucket \u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637 \u2014 \u0623\u0636\u0641 BUCKET binding \u0641\u064A Pages Dashboard \u0628\u0627\u0633\u0645 BUCKET \u0623\u0648 BUCKET-1");
  }
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ") || auth.length < 20) {
    return fail2(401, "\u063A\u064A\u0631 \u0645\u0635\u0631\u0651\u062D");
  }
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return fail2(400, "\u0628\u064A\u0627\u0646\u0627\u062A \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629");
  }
  const file = formData.get("file");
  const path = formData.get("path");
  if (!file || !path) {
    return fail2(400, "\u0627\u0644\u062D\u0642\u0648\u0644 file \u0648 path \u0645\u0637\u0644\u0648\u0628\u0629");
  }
  if (path.includes("..") || path.startsWith("/") || !/^[\w\-/]+\.(jpe?g|webp)$/.test(path)) {
    return fail2(400, "\u0645\u0633\u0627\u0631 \u063A\u064A\u0631 \u0645\u0633\u0645\u0648\u062D \u0628\u0647");
  }
  if (file.size > 5 * 1024 * 1024) {
    return fail2(413, "\u062D\u062C\u0645 \u0627\u0644\u0635\u0648\u0631\u0629 \u0628\u0639\u062F \u0627\u0644\u0636\u063A\u0637 \u0643\u0628\u064A\u0631 \u062C\u062F\u0627\u064B \u2014 \u0627\u0644\u062D\u062F \u0627\u0644\u0623\u0642\u0635\u0649 5 MB");
  }
  try {
    const buffer = await file.arrayBuffer();
    const contentType = file.type && file.type.startsWith("image/") ? file.type : "image/jpeg";
    await bucket.put(path, buffer, {
      httpMetadata: { contentType }
    });
    const url = `${R2_PUBLIC_BASE2}/${path}`;
    return ok2({ url });
  } catch (e) {
    return fail2(500, e.message || "\u0641\u0634\u0644 \u0631\u0641\u0639 \u0627\u0644\u0635\u0648\u0631\u0629");
  }
}
__name(onRequestPost2, "onRequestPost");
function ok2(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...CORS2, "Content-Type": "application/json" }
  });
}
__name(ok2, "ok");
function fail2(status, error) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...CORS2, "Content-Type": "application/json" }
  });
}
__name(fail2, "fail");

// ../.wrangler/tmp/pages-fTdX76/functionsRoutes-0.2744205881877627.mjs
var routes = [
  {
    routePath: "/admin/auth",
    mountPath: "/admin",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost]
  },
  {
    routePath: "/admin/listings",
    mountPath: "/admin",
    method: "",
    middlewares: [],
    modules: [onRequest]
  },
  {
    routePath: "/delete-listing",
    mountPath: "/",
    method: "DELETE",
    middlewares: [],
    modules: [onRequestDelete]
  },
  {
    routePath: "/delete-listing",
    mountPath: "/",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions]
  },
  {
    routePath: "/upload",
    mountPath: "/",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions2]
  },
  {
    routePath: "/upload",
    mountPath: "/",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost2]
  }
];

// C:/Users/XPRISTO/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/path-to-regexp/dist.es2015/index.js
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");

// C:/Users/XPRISTO/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/pages-template-worker.ts
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");
export {
  pages_template_worker_default as default
};
