// Ambient window globals for the no-build frontend (#331). Type declarations
// only; nothing here ships or compiles. Runtime code stays plain .js.
//
// @supabase/supabase-js is a type-only devDependency -- never imported at
// runtime. The CDN script tag on index.html/officer.html supplies the real
// UMD global; this just describes its shape so tsc can check calls against
// it. js/database.types.ts is generated via `supabase gen types typescript
// --linked --schema public` and re-run whenever the schema changes.
import type { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

// The top-level `import`s above make this file a module, which would
// otherwise scope `interface Window` to the module instead of augmenting the
// real global -- `declare global` is what puts it back on the ambient type
// every plain <script> file sees.
declare global {
  interface Window {
    // undefined when the CDN script fails to load (every use across js/ is
    // guarded with `if (!supabaseClient) ...` for exactly that reason).
    supabase?: { createClient: typeof createClient<Database> };
    // JSONP callbacks for the GAS core/heavy payload chunks (loadData in
    // common.js). The GAS response script calls them by name, so they must
    // live on window.
    _rosterCoreCallback?: (data: any) => void;
    _rosterHeavyCallback?: (heavy: any) => void;
  }
}
