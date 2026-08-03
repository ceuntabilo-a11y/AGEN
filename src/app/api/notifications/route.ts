import { NextResponse } from 'next/server'
import { apiError } from '@/lib/http-errors'
import { createAdminClient } from '@/lib/supabase-admin'
import { createServerSupabase } from '@/lib/supabase-server'

export const dynamic='force-dynamic'

export async function GET(){
  try{
    const session=await createServerSupabase()
    const {data:{user}}=await session.auth.getUser()
    if(!user)return NextResponse.json({error:'No autenticado'},{status:401})
    const db=createAdminClient()
    const {data,error}=await db.from('team_notifications').select('id,kind,title,body,payload,read_at,created_at').eq('recipient_user_id',user.id).order('created_at',{ascending:false}).limit(30)
    if(error)throw error
    return NextResponse.json({notifications:data??[],unread:(data??[]).filter(item=>!item.read_at).length})
  }catch(error){return apiError(error)}
}

export async function PATCH(request:Request){
  try{
    const session=await createServerSupabase()
    const {data:{user}}=await session.auth.getUser()
    if(!user)return NextResponse.json({error:'No autenticado'},{status:401})
    const body=await request.json() as {id?:number;all?:boolean}
    const db=createAdminClient()
    let query=db.from('team_notifications').update({read_at:new Date().toISOString()}).eq('recipient_user_id',user.id).is('read_at',null)
    if(!body.all){if(!body.id)return NextResponse.json({error:'Falta la notificación'},{status:400});query=query.eq('id',body.id)}
    const {error}=await query
    if(error)throw error
    return NextResponse.json({ok:true})
  }catch(error){return apiError(error)}
}
