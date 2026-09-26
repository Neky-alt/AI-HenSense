import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL) {
    const url=new URL(`${specifier}.ts`,context.parentURL);
    if (existsSync(fileURLToPath(url))) return nextResolve(url.href,context);
  }
  return nextResolve(specifier,context);
}, load(url, context, next) {
  // These mapping tests have a signed-in fixture; no native runtime or live Auth.
  if (url.endsWith('/src/lib/supabase.ts')) return {format:'module',shortCircuit:true,source:`export const supabase={auth:{onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}},async getSession(){return {data:{session:{user:{id:'fixture-user'},access_token:'fixture-token'}},error:null}}}};`};
  return next(url,context);
} });
