/* Routines - the offline shell.

   Stale-while-revalidate: a launch is answered from the cache straight away and
   the network copy quietly replaces it, so a push to main shows up on the next
   launch after this one with nobody bumping a version string. VERSION only has
   to change when this file's own logic does.

   Sync is a POST, so it never touches this - offline the app runs on what is in
   localStorage, and the next pull sorts the devices out. */

var VERSION="routines-v1";
var SHELL=["./","./index.html","./icon.png"];

self.addEventListener("install",function(e){
  e.waitUntil(caches.open(VERSION).then(function(c){
    /* one miss must not sink the install - icon.png is optional by design */
    return Promise.all(SHELL.map(function(u){ return c.add(u).catch(function(){}); }));
  }).then(function(){ return self.skipWaiting(); }));
});

self.addEventListener("activate",function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.map(function(k){
      return k===VERSION? null : caches.delete(k);
    }));
  }).then(function(){ return self.clients.claim(); }));
});

self.addEventListener("fetch",function(e){
  var req=e.request;
  if(req.method!=="GET") return;
  var url=new URL(req.url);
  var mine = url.origin===self.location.origin;
  var font = url.hostname==="fonts.googleapis.com" || url.hostname==="fonts.gstatic.com";
  if(!mine && !font) return;

  e.respondWith(caches.open(VERSION).then(function(c){
    /* a setup link arrives with a hash and sometimes a query - neither changes
       which page is being asked for */
    return c.match(req,{ignoreSearch:req.mode==="navigate"}).then(function(hit){
      var net=fetch(req).then(function(res){
        /* opaque is what a cross-origin font comes back as: uninspectable, still
           replayable, and the only way the wordmark survives a dead network */
        if(res && (res.ok||res.type==="opaque")) c.put(req,res.clone());
        return res;
      });
      if(hit){ e.waitUntil(net.catch(function(){})); return hit; }
      return net;
    });
  }));
});
