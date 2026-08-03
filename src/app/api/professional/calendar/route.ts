import {NextResponse} from 'next/server'
import {apiError} from '@/lib/http-errors'
import {requireProfessionalContext} from '@/lib/professional-context'

export const dynamic='force-dynamic'

export async function GET(){try{const {professional}=await requireProfessionalContext();return NextResponse.json({calendarToken:professional.calendar_token??null,hideClientNames:professional.calendar_hide_client_names??false})}catch(error){return apiError(error)}}

export async function POST(request:Request){
  try{
    const {db,businessId,professional}=await requireProfessionalContext()
    const body=await request.json() as {action?:'generate'|'privacy';hideClientNames?:boolean}
    const changes:Record<string,unknown>={}
    if(body.action==='generate')changes.calendar_token=crypto.randomUUID()
    else if(body.action==='privacy')changes.calendar_hide_client_names=!!body.hideClientNames
    else return NextResponse.json({error:'Acción inválida'},{status:400})
    const {data,error}=await db.from('professionals').update(changes).eq('id',professional.id).eq('business_id',businessId).select('calendar_token,calendar_hide_client_names').single()
    if(error)throw error
    return NextResponse.json({calendarToken:data.calendar_token,hideClientNames:data.calendar_hide_client_names})
  }catch(error){return apiError(error)}
}
