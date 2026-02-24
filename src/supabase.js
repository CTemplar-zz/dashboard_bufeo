import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://wbhrkfdsyofwsruknzlv.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndiaHJrZmRzeW9md3NydWtuemx2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0MjE3MTQsImV4cCI6MjA4Njk5NzcxNH0.-_GPONAIgp0dctG2PHAkNwaCWBkxgEWw6aVtsBDdRHQ'

export const supabase = createClient(supabaseUrl, supabaseKey)
