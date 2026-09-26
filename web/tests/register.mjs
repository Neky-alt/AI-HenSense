// Data/display unit tests use a signed-in fixture, never a live Supabase project.
// Actual auth transitions are covered separately by accountIsolation.test.mjs.
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
const fixture = `export const supabase = {auth:{onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}},async getSession(){return {data:{session:{user:{id:'fixture-user'},access_token:'fixture-token'}},error:null}}}};`;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL) {
      const url = new URL(specifier + '.ts', context.parentURL);
      if (existsSync(url)) return next(url.href, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('/src/lib/supabase.ts')) return {format:'module',shortCircuit:true,source:fixture};
    if (url.endsWith('/src/contexts/AuthContext.tsx')) return {format:'module',shortCircuit:true,source:`export const useAuth=()=>({user:{id:'fixture-user'}});`};
    return next(url, context);
  },
});
