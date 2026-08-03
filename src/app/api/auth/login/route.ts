import {createHash} from 'node:crypto'
import {NextResponse} from 'next/server'
import {createAdminClient} from '@/lib/supabase-admin'
import {createServerSupabase} from '@/lib/supabase-server'

const hash=(value:string)=>createHash('sha256').update(value).digest('hex')

export async function POST(request:Request){
  const body=await request.json().catch(()=>({})) as {email?:string;password?:string}
  const email=body.email?.trim().toLowerCase(),password=body.password
  if(!email||!password)return NextResponse.json({error:'Correo y contraseña son obligatorios'},{status:400})
  const forwarded=request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||request.headers.get('x-real-ip')||'unknown'
  const emailHash=hash(email),ipHash=hash(forwarded),since=new Date(Date.now()-15*60*1000).toISOString(),db=createAdminClient()
  const [emailFailures,ipFailures]=await Promise.all([
    db.from('login_attempts').select('id',{count:'exact',head:true}).eq('email_hash',emailHash).eq('succeeded',false).gte('created_at',since),
    db.from('login_attempts').select('id',{count:'exact',head:true}).eq('ip_hash',ipHash).eq('succeeded',false).gte('created_at',since),
  ])
  if((emailFailures.count??0)>=5||(ipFailures.count??0)>=20)return NextResponse.json({error:'Demasiados intentos. Espera 15 minutos antes de volver a probar.'},{status:429})
  const auth=await createServerSupabase()
  const {data,error}=await auth.auth.signInWithPassword({email,password})
  if(error||!data.user){await db.from('login_attempts').insert({email_hash:emailHash,ip_hash:ipHash,succeeded:false});return NextResponse.json({error:'Correo o contraseña incorrectos'},{status:401})}
  await Promise.all([
    db.from('login_attempts').insert({email_hash:emailHash,ip_hash:ipHash,succeeded:true}),
    db.from('login_attempts').delete().eq('email_hash',emailHash).eq('succeeded',false),
  ])
  return NextResponse.json({ok:true})
}
