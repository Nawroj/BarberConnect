import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  // Create a Supabase client on the browser
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}