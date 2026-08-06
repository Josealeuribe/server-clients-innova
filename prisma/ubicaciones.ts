// División política ofrecida en el registro. Esta es la FUENTE DE VERDAD:
// antes vivía en src/shared/data/colombia.ts del frontend, lo que significaba
// que el backend aceptaba cualquier texto como departamento y ciudad.
//
// Gran Casino Cúcuta opera sus 3 sedes en Cúcuta, así que Norte de Santander
// va primero y completo: sus 40 municipios. Después los departamentos vecinos
// (Santander, Cesar, Arauca, Boyacá), de donde llega el resto del público
// regional, y al final las plazas nacionales grandes.

// Área Metropolitana de Cúcuta: los 6 municipios que la conforman legalmente.
// Van de primeros dentro de Norte de Santander porque concentran casi todo el
// público de las sedes.
const AREA_METROPOLITANA_CUCUTA = [
  'Cúcuta',
  'Villa del Rosario',
  'Los Patios',
  'El Zulia',
  'San Cayetano',
  'Puerto Santander',
]

// Los 34 municipios restantes de Norte de Santander, en orden alfabético.
const RESTO_NORTE_DE_SANTANDER = [
  'Ábrego',
  'Arboledas',
  'Bochalema',
  'Bucarasica',
  'Cáchira',
  'Cácota',
  'Chinácota',
  'Chitagá',
  'Convención',
  'Cucutilla',
  'Durania',
  'El Carmen',
  'El Tarra',
  'Gramalote',
  'Hacarí',
  'Herrán',
  'La Esperanza',
  'La Playa de Belén',
  'Labateca',
  'Lourdes',
  'Mutiscua',
  'Ocaña',
  'Pamplona',
  'Pamplonita',
  'Ragonvalia',
  'Salazar de Las Palmas',
  'San Calixto',
  'Santiago',
  'Sardinata',
  'Silos',
  'Teorama',
  'Tibú',
  'Toledo',
  'Villa Caro',
]

interface Departamento {
  nombre: string
  municipios: string[]
}

export const DEPARTAMENTOS: Departamento[] = [
  {
    nombre: 'Norte de Santander',
    municipios: [...AREA_METROPOLITANA_CUCUTA, ...RESTO_NORTE_DE_SANTANDER],
  },
  {
    nombre: 'Santander',
    municipios: [
      'Bucaramanga',
      'Floridablanca',
      'Girón',
      'Piedecuesta',
      'Barrancabermeja',
      'Barbosa',
      'California',
      'Cerrito',
      'Concepción',
      'El Playón',
      'Guaca',
      'Málaga',
      'Matanza',
      'Rionegro',
      'Sabana de Torres',
      'San Andrés',
      'San Gil',
      'San Vicente de Chucurí',
      'Socorro',
      'Suratá',
      'Tona',
      'Vélez',
      'Vetas',
    ],
  },
  {
    nombre: 'Cesar',
    municipios: [
      'Valledupar',
      'Aguachica',
      'Agustín Codazzi',
      'Bosconia',
      'Chimichagua',
      'Chiriguaná',
      'Curumaní',
      'El Copey',
      'Gamarra',
      'González',
      'La Gloria',
      'La Jagua de Ibirico',
      'Pailitas',
      'Pelaya',
      'Río de Oro',
      'San Alberto',
      'San Martín',
      'Tamalameque',
    ],
  },
  {
    nombre: 'Arauca',
    municipios: ['Arauca', 'Arauquita', 'Cravo Norte', 'Fortul', 'Puerto Rondón', 'Saravena', 'Tame'],
  },
  {
    nombre: 'Boyacá',
    municipios: [
      'Tunja',
      'Duitama',
      'Sogamoso',
      'Chiquinquirá',
      'Cubará',
      'Chiscas',
      'El Cocuy',
      'El Espino',
      'Güicán',
      'Guacamayas',
      'Panqueba',
      'Paipa',
      'Puerto Boyacá',
    ],
  },
  {
    nombre: 'Cundinamarca',
    municipios: ['Bogotá', 'Soacha', 'Chía', 'Zipaquirá', 'Facatativá', 'Fusagasugá', 'Girardot', 'Mosquera'],
  },
  {
    nombre: 'Antioquia',
    municipios: ['Medellín', 'Bello', 'Itagüí', 'Envigado', 'Apartadó', 'Rionegro', 'Sabaneta', 'Turbo'],
  },
  {
    nombre: 'Atlántico',
    municipios: ['Barranquilla', 'Soledad', 'Malambo', 'Sabanalarga', 'Puerto Colombia', 'Galapa'],
  },
  {
    nombre: 'Bolívar',
    municipios: ['Cartagena', 'Magangué', 'El Carmen de Bolívar', 'Mompox', 'Turbaco', 'Arjona'],
  },
  {
    nombre: 'Valle del Cauca',
    municipios: ['Cali', 'Palmira', 'Buenaventura', 'Tuluá', 'Buga', 'Cartago', 'Jamundí', 'Yumbo'],
  },
]

// Total de municipios ofrecidos, para que el seed pueda reportarlo.
export const TOTAL_MUNICIPIOS = DEPARTAMENTOS.reduce((n, d) => n + d.municipios.length, 0)
