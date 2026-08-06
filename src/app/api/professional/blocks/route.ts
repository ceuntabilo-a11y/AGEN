import { NextResponse } from 'next/server'
import { requireProfessionalContext } from '@/lib/professional-context'
import { apiError } from '@/lib/http-errors'
export async function POST(request:Request){try{const {db,businessId,professional}=await requireProfessionalContext();const body=await request.json() as {from?:string;until?:string;reason?:string};if(!body.from||!body.until||new Date(body.until)<=new Date(body.from))return NextResponse.json({error:'Horario inválido'},{status:400});const {data,error}=await db.from('schedule_blocks').insert({business_id:businessId,professional_id:professional.id,period:`[${body.from},${body.until})`,reason:body.reason?.slice(0,300)??null}).select().single();if(error)throw error;return NextResponse.json({block:data},{status:201})}catch(error){return apiError(error)}}

export async function DELETE(request:Request){
  try{
    const {db,professional}=await requireProfessionalContext()
    const id=new URL(request.url).searchParams.get('id')
    if(!id)return NextResponse.json({error:'Falta el bloqueo'},{status:400})
    const {data,error}=await db.from('schedule_blocks').delete().eq('id',id).eq('professional_id',professional.id).select('id').maybeSingle()
    if(error)throw error
    if(!data)return NextResponse.json({error:'Ese bloqueo no es tuyo'},{status:404})
    return NextResponse.json({ok:true})
  }catch(error){return apiError(error)}
}
