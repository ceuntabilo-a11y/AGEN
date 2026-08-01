export const professionals = [
  { id: 'p1', name: 'Valentina Rojas', specialty: 'Peluquería', color: '#7c5cff', initials: 'VR' },
  { id: 'p2', name: 'Camila Soto', specialty: 'Peluquería', color: '#ff6f91', initials: 'CS' },
  { id: 'p3', name: 'Isabella Díaz', specialty: 'Manicure', color: '#17b890', initials: 'ID' },
  { id: 'p4', name: 'Martina Silva', specialty: 'Pedicure', color: '#ff9f43', initials: 'MS' },
  { id: 'p5', name: 'Sofía Torres', specialty: 'Masajes', color: '#2d9cdb', initials: 'ST' },
]

export const services = [
  { id: 's1', name: 'Corte y peinado', specialty: 'Peluquería', duration: 60, price: 28000, cost: 3500 },
  { id: 's2', name: 'Coloración completa', specialty: 'Peluquería', duration: 150, price: 72000, cost: 18500 },
  { id: 's3', name: 'Manicure permanente', specialty: 'Manicure', duration: 75, price: 24000, cost: 4200 },
  { id: 's4', name: 'Pedicure spa', specialty: 'Pedicure', duration: 75, price: 29000, cost: 5200 },
  { id: 's5', name: 'Masaje relajante', specialty: 'Masajes', duration: 60, price: 35000, cost: 1800 },
]

export const appointments = [
  { id: 'a1', time: '09:00', end: '10:00', client: 'María González', professionalId: 'p1', serviceId: 's1', status: 'Confirmada' },
  { id: 'a2', time: '09:30', end: '10:45', client: 'Fernanda López', professionalId: 'p3', serviceId: 's3', status: 'Confirmada' },
  { id: 'a3', time: '10:30', end: '13:00', client: 'Antonia Ruiz', professionalId: 'p2', serviceId: 's2', status: 'En atención' },
  { id: 'a4', time: '11:00', end: '12:15', client: 'Daniela Pérez', professionalId: 'p4', serviceId: 's4', status: 'Pendiente' },
  { id: 'a5', time: '13:00', end: '14:00', client: 'Laura Méndez', professionalId: 'p5', serviceId: 's5', status: 'Confirmada' },
  { id: 'a6', time: '14:30', end: '15:30', client: 'Carolina Vera', professionalId: 'p1', serviceId: 's1', status: 'Confirmada' },
  { id: 'a7', time: '15:00', end: '16:15', client: 'Paula Reyes', professionalId: 'p3', serviceId: 's3', status: 'Confirmada' },
]

export const money = (value: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(value)
