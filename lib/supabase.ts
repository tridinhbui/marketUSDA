import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://rtfvkquthwtgegcjxeoz.supabase.co";
const supabaseAnonKey = "sb_publishable_Xp71GX-0a3jM525UA8TeBQ__lxVxV5A";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
