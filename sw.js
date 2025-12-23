const CACHE = "fpl-members-v1";
const ASSETS = ["/", "/index.html", "/style.css", "/script.js"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  if (ASSETS.includes(url.pathname)) {
    e.respondWith(caches.match(e.request));
    return;
  }

  if (url.origin.includes("fantasy.premierleague.com")) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  }
});
