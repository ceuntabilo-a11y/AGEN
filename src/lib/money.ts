export function money(value:number,currency='CLP'){
  return new Intl.NumberFormat('es-CL',{style:'currency',currency,maximumFractionDigits:currency==='CLP'?0:2}).format(value)
}
