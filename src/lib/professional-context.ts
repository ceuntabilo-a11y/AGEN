import { requireBusinessContext } from '@/lib/supabase-server'

export async function requireProfessionalContext(){
  const context=await requireBusinessContext(['PROFESSIONAL'])
  const {data:professional,error}=await context.db.from('professionals').select('id,display_name,color,commission_percent,branch_id').eq('business_id',context.businessId).eq('member_id',context.memberId).eq('active',true).single()
  if(error||!professional)throw new Error('FORBIDDEN')
  return {...context,professional}
}
