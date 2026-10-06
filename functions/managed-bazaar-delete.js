import {buildReferenceIndex,urlToKey,baseOf} from './admin/_media.js';
import {cleanupManagedConsents} from './admin/_managed-consents.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export async function onRequestPost({request,env}) {
  const origin=request.headers.get('Origin');
  if(origin&&origin!==new URL(request.url).origin)return json({error:'unauthorized'},403);
  const authorization=request.headers.get('Authorization')||'';
  if(!/^Bearer \S+$/.test(authorization))return json({error:'login_required'},401);
  const url=env.SUPABASE_URL,key=env.SUPABASE_SERVICE_KEY;
  if(!url||!key)return json({error:'Server configuration unavailable'},503);
  const userHeaders={apikey:key,Authorization:authorization,'Content-Type':'application/json'};
  try {
    const auth=await fetch(`${url}/auth/v1/user`,{headers:userHeaders});
    if(!auth.ok)return json({error:'login_required'},401);
    const identity=await auth.json();if(!identity.id)return json({error:'login_required'},401);
    const admin=await fetch(`${url}/rest/v1/rpc/is_admin`,{method:'POST',headers:userHeaders,body:'{}'});
    if(!admin.ok||await admin.json()!==true)return json({error:'unauthorized'},403);
    const body=await request.json().catch(()=>null);
    if(!body||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.external_id||''))return json({error:'Invalid bazaar ID'},400);
    const purge=await fetch(`${url}/rest/v1/rpc/admin_delete_unused_managed_bazaar`,{
      method:'POST',headers:userHeaders,body:JSON.stringify({p_external_id:body.external_id}),
    });
    const data=await purge.json();
    if(!purge.ok)return json({error:data.message||'managed_delete_failed'},purge.status===401||purge.status===403?purge.status:409);
    const serviceHeaders={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
    let deleted=0,consents=0,pending=false;
    // The transaction queued image deletion. Never remove shared or unknown files.
    if(data.images?.length){
      const bucket=env.BUCKET||env['BUCKET-1'];
      if(!bucket)pending=true;
      else try {
        const {refs}=await buildReferenceIndex(url,serviceHeaders);
        const keys=[...new Set(data.images.map(urlToKey).filter(k=>k?.startsWith('bazaars/')&&!refs.has(baseOf(k))))];
        for(const key of keys){await bucket.delete(key);deleted++;}
      }catch(e){pending=true;console.error('Managed bazaar image cleanup:',e.message);}
    }
    if(data.consent_paths?.length)try{consents=await cleanupManagedConsents(url,serviceHeaders,data.consent_paths);}
    catch(e){pending=true;console.error('Managed bazaar consent cleanup:',e.message);}
    return json({ok:true,images_deleted:deleted,consents_deleted:consents,cleanup_pending:pending});
  }catch(e){console.error('Managed bazaar deletion:',e.message);return json({error:'managed_delete_failed'},503);}
}
