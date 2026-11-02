/* Routines on Cloudflare Pages: hands the server key to a browser that Cloudflare
   Access has already signed in. This runs on the same origin as index.html, so the
   app calls it with no setup, and a device connects itself after a Google sign-in.

   Access gates every path on this hostname, including this one, and stamps each
   request it lets through with a signed token (Cf-Access-Jwt-Assertion). The token
   is checked here all the same - against the team's public keys, the app's audience
   tag and its expiry - so a misconfigured Access policy can't leak the key.

   Environment variables, set in the Pages project (Settings -> Variables and Secrets):
     ROUTINES_KEY            the server key (CONSOLE_SECRET on Railway)   - secret
     CF_ACCESS_TEAM_DOMAIN   e.g. "myteam" or "myteam.cloudflareaccess.com"
     CF_ACCESS_AUD           the Access application's Audience (AUD) tag
     ROUTINES_SERVER         optional; the console address, if not the default

   Without them the function answers 503 and the app behaves as it always did:
   Local only, with the key typed once under Edit list -> Routines server. */

var DEFAULT_SERVER="https://server-production-5580.up.railway.app";
var certCache={at:0,keys:null,team:""};

export async function onRequestPost(context){
  var env=context.env||{};
  var team=String(env.CF_ACCESS_TEAM_DOMAIN||"").trim().replace(/^https?:\/\//,"").replace(/\/.*$/,"");
  if(team&&team.indexOf(".")<0) team+=".cloudflareaccess.com";
  var aud=String(env.CF_ACCESS_AUD||"").trim(), key=String(env.ROUTINES_KEY||"");
  if(!team||!aud||!key) return json({error:"Not configured"},503);

  var jwt=context.request.headers.get("Cf-Access-Jwt-Assertion")||cookie(context.request.headers.get("Cookie"),"CF_Authorization");
  if(!jwt) return json({error:"Not signed in"},401);
  var who=await verify(jwt,team,aud);
  if(!who) return json({error:"Not signed in"},401);
  return json({url:String(env.ROUTINES_SERVER||DEFAULT_SERVER).replace(/\/+$/,""),key:key,email:who.email||""});
}
export function onRequest(context){
  if(context.request.method==="POST") return onRequestPost(context);
  return json({error:"POST only"},405);
}

function json(body,status){
  return new Response(JSON.stringify(body),{status:status||200,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
}
function cookie(header,name){
  var m=new RegExp("(?:^|;\\s*)"+name+"=([^;]+)").exec(header||"");
  return m? m[1] : "";
}
function b64url(s){
  s=s.replace(/-/g,"+").replace(/_/g,"/"); while(s.length%4) s+="=";
  var bin=atob(s), out=new Uint8Array(bin.length);
  for(var i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i);
  return out;
}
function decode(part){ return JSON.parse(new TextDecoder().decode(b64url(part))); }

async function certs(team){
  var now=Date.now();
  if(certCache.keys&&certCache.team===team&&now-certCache.at<3600000) return certCache.keys;
  var res=await fetch("https://"+team+"/cdn-cgi/access/certs");
  if(!res.ok) throw new Error("certs "+res.status);
  var data=await res.json();
  certCache={at:now,keys:data.keys||[],team:team};
  return certCache.keys;
}

/* RS256 only, which is what Access issues. Returns the payload or null. */
async function verify(jwt,team,aud){
  try{
    var parts=jwt.split("."); if(parts.length!==3) return null;
    var header=decode(parts[0]), payload=decode(parts[1]);
    if(header.alg!=="RS256") return null;
    var now=Math.floor(Date.now()/1000);
    if(!payload.exp||payload.exp<now) return null;
    if(payload.nbf&&payload.nbf>now+60) return null;
    if(payload.iss!=="https://"+team) return null;
    var auds=Array.isArray(payload.aud)?payload.aud:[payload.aud];
    if(auds.indexOf(aud)<0) return null;
    var keys=await certs(team), jwk=null;
    keys.forEach(function(k){ if(k.kid===header.kid) jwk=k; });
    if(!jwk){ certCache.at=0; keys=await certs(team); keys.forEach(function(k){ if(k.kid===header.kid) jwk=k; }); }
    if(!jwk) return null;
    var pub=await crypto.subtle.importKey("jwk",{kty:jwk.kty,n:jwk.n,e:jwk.e,alg:"RS256",ext:true},{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
    var ok=await crypto.subtle.verify("RSASSA-PKCS1-v1_5",pub,b64url(parts[2]),new TextEncoder().encode(parts[0]+"."+parts[1]));
    return ok? payload : null;
  }catch(e){ return null; }
}
