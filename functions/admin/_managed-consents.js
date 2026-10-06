/* Private files must be removed through Storage API, after checking all live
   agreements and frozen booking terms. Failures remain eligible for retry. */
export async function cleanupManagedConsents(SUPABASE_URL, sbHeaders, paths = null) {
  const response=await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_unused_managed_bazaar_consents`,{
    method:'POST',headers:sbHeaders,body:JSON.stringify({p_paths:paths}),
  });
  if(!response.ok)throw new Error('Consent reference check failed: '+response.status);
  const unused=await response.json();
  if(!Array.isArray(unused))throw new Error('Invalid consent reference response');
  if(!unused.length)return 0;
  const deleted=await fetch(`${SUPABASE_URL}/storage/v1/object/managed-bazaar-consents`,{
    method:'DELETE',headers:sbHeaders,body:JSON.stringify({prefixes:unused}),
  });
  if(!deleted.ok)throw new Error('Consent storage deletion failed: '+deleted.status);
  return unused.length;
}
