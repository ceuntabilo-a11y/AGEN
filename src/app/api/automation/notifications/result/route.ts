import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
export async function POST(request:Request){if(!isAuthorizedAgent(request))return NextResponse.json({error:'No autorizado'},{status:401});const body=await request.json() as {id?:number;success?:boolean;error?:string};if(!body.id)return NextResponse.json({error:'id obligatorio'},{status:400});const {error}=await createAdminClient().from('notification_outbox').update(body.success?{processed_at:new Date().toISOString(),last_error:null}:{last_error:body.error?.slice(0,1000)??'Error desconocido'}).eq('id',body.id);if(error)return NextResponse.json({error:'No se pudo actualizar'},{status:500});return NextResponse.json({updated:true})}
