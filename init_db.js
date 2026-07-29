// init_db.js
const { Pool } = require('pg');
require('dotenv').config();

const poolConfig = process.env.DATABASE_URL 
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    }
  : {
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
    };

const pool = new Pool(poolConfig);

const initScript = `

CREATE TABLE IF NOT EXISTS cat_horarios (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(50) UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS cat_periodos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(50) UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS cat_carreras (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(150) UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS cat_materias (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    carrera_id INTEGER REFERENCES cat_carreras(id) ON DELETE CASCADE,
    UNIQUE(nombre, carrera_id)
);

CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    aula_id INTEGER,
    is_active BOOLEAN DEFAULT true -- AÑADIDO: Control de baneo
);

CREATE TABLE IF NOT EXISTS aulas (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    code VARCHAR(10) UNIQUE NOT NULL,
    teacher_id INTEGER REFERENCES usuarios(id),
    horario_id INTEGER REFERENCES cat_horarios(id),
    periodo_id INTEGER REFERENCES cat_periodos(id),
    materia_id INTEGER REFERENCES cat_materias(id),
    nivel INTEGER,    -- AÑADIDO: Semestre/Nivel de la materia
    aula_num INTEGER, -- AÑADIDO: Aula física
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE usuarios ADD CONSTRAINT fk_aula FOREIGN KEY (aula_id) REFERENCES aulas(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS desafios (
    id SERIAL PRIMARY KEY,
    nivel INTEGER UNIQUE NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    descripcion_nivel TEXT DEFAULT 'Aprende los conceptos básicos del pensamiento computacional.',
    descripcion_juego TEXT DEFAULT 'Ayuda al personaje a llegar a la meta utilizando el menor número de comandos posibles.',
    objetivos JSONB DEFAULT '["Lleva al robot a la bandera", "Evita los muros oscuros"]'
);

CREATE TABLE IF NOT EXISTS insignias (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(50) UNIQUE NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT,
    imagen_url VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS insignias_estudiante (
    id SERIAL PRIMARY KEY,
    student_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
    insignia_id INTEGER REFERENCES insignias(id) ON DELETE CASCADE,
    fecha_obtenida TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(student_id, insignia_id)
);

CREATE TABLE IF NOT EXISTS intentos_desafio (
    id SERIAL PRIMARY KEY,
    student_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
    nivel INTEGER REFERENCES desafios(nivel) ON UPDATE CASCADE ON DELETE CASCADE, -- Corregida Relación Foránea Directa
    dificultad VARCHAR(20) CHECK (dificultad IN ('easy', 'medium', 'hard')),
    estado VARCHAR(20) CHECK (estado IN ('completado', 'fallido', 'abandonado')),
    tiempo_segundos INTEGER NOT NULL,
    pistas_utilizadas INTEGER DEFAULT 0,
    fecha_intento TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- DATOS SEMILLA (Seed Data)

INSERT INTO desafios (nivel, nombre, descripcion_nivel, descripcion_juego, objetivos) VALUES 
(1, 'Secuenciación', 'Aprende a dar instrucciones paso a paso en el orden correcto.', 'El robot explorador necesita llegar a la base de carga. Tu misión es darle las instrucciones correctas, paso a paso, para que no se estrelle.', '["Programa la ruta hasta la bandera verde.", "Usa los botones de dirección.", "Cuidado con los muros grises."]'),
(2, 'Patrones', 'Identifica los patrones y úsalos tu a favor.', 'Tu misión es apagar todas las luces del tablero usando un patrón.', '["Apagar completamente todo el tablero", "Identificar el patrón de apagado o encendido", "Usar pocos movimientos"]'),
(3, 'Repeticiones', 'Aprende a usar repeticiones para simplificar secuencias.', 'Tu misión es ayudar al robot a llegar a la meta, usando secuencias repetidas.', '["Llegar a la meta", "No chocar con obstáculos", "Usar bloques de repetición, para repetir el movimiento del robot"]'),
(4, 'Condicionales', 'Aprende el funcionamiento básico de las condicionales y sus operadores.', 'Tu misión es encontrar los pares de las tarjetas y agruparlas donde pertenecen.', '["Descubrir todos los pares", "Identificar si son operadores condicionales u operadores matemáticos"]'),
(5, 'Descomposición', 'Aprende a descomponer problemas grandes en trozos más pequeños.', 'Tu misión es rellenar el tablero de rectángulos, usando la cantidad de áreas que ves en el tablero.', '["Rellenar el tablero completamente", "El área total debe ser del tamaño al número que encerraste"]')
ON CONFLICT (nivel) DO UPDATE SET 
    nombre = EXCLUDED.nombre,
    descripcion_nivel = EXCLUDED.descripcion_nivel,
    descripcion_juego = EXCLUDED.descripcion_juego,
    objetivos = EXCLUDED.objetivos;

INSERT INTO insignias (codigo, nombre, descripcion, imagen_url) VALUES 
('lvl1_complete', 'Primer Paso', 'Completó el Nivel 1 en todas sus dificultades', 'assets/pictures/insigneas/primerSecuenciacion.png'),
('proTimer', 'Veloz', 'Completó el modo carrera en menos de 60 segundos', 'assets/pictures/insigneas/timerSecuenciacion.png'),
('proSecuenciacion', 'Lógica Pro', 'Pasó el modo carrera sin fallar ni una sola vez', 'assets/pictures/insigneas/proSecuenciacion.png'),
('masterSecuenciacion', 'Imparable', 'Consiguió ser Veloz y Lógica Pro al mismo tiempo', 'assets/pictures/insigneas/masterSecuenciacion.png'),

('lvl2_complete', 'Buscador de Patrones', 'Completó el Nivel 2 en todas sus dificultades', 'assets/pictures/insigneas/primerPatrones.png'),
('timerPatrones', 'Veloz en Patrones', 'Completó el modo carrera del Nivel 2 en tiempo récord', 'assets/pictures/insigneas/timerPatrones.png'),
('proPatrones', 'Pro de los Patrones', 'Pasó el modo carrera del Nivel 2 sin fallar', 'assets/pictures/insigneas/proPatrones.png'),
('masterPatrones', 'Maestro de Patrones', 'Consiguió ser Veloz y Pro en el Nivel 2 al mismo tiempo', 'assets/pictures/insigneas/masterPatrones.png'),

('lvl3_complete', 'Rey del Bucle', 'Completó el Nivel 3 en todas sus dificultades', 'assets/pictures/insigneas/primerRepeticiones.png'),
('timerRepeticiones', 'Veloz en Repeticiones', 'Completó el modo carrera del Nivel 3 en tiempo récord', 'assets/pictures/insigneas/timerRepeticiones.png'),
('proRepeticiones', 'Pro de las Repeticiones', 'Pasó el modo carrera del Nivel 3 sin fallar', 'assets/pictures/insigneas/proRepeticiones.png'),
('masterRepeticiones', 'Maestro de Repeticiones', 'Consiguió ser Veloz y Pro en el Nivel 3 al mismo tiempo', 'assets/pictures/insigneas/masterRepeticiones.png'),

('lvl4_complete', 'Tomador de Decisiones', 'Completó el Nivel 4 en todas sus dificultades', 'assets/pictures/insigneas/primerCondicionales.png'),
('timerCondicionales', 'Veloz en Condicionales', 'Completó el modo carrera del Nivel 4 en tiempo récord', 'assets/pictures/insigneas/timerCondicionales.png'),
('proCondicionales', 'Pro de las Condicionales', 'Pasó el modo carrera del Nivel 4 sin fallar', 'assets/pictures/insigneas/proCondicionales.png'),
('masterCondicionales', 'Maestro de Condicionales', 'Consiguió ser Veloz y Pro en el Nivel 4 al mismo tiempo', 'assets/pictures/insigneas/masterCondicionales.png'),

('lvl5_complete', 'Analista de Problemas', 'Completó el Nivel 5 en todas sus dificultades', 'assets/pictures/insigneas/primerDescomposicion.png'),
('timerDescomposicion', 'Veloz en Descomposición', 'Completó el modo carrera del Nivel 5 en tiempo récord', 'assets/pictures/insigneas/timerDescomposicion.png'),
('proDescomposicion', 'Pro de la Descomposición', 'Pasó el modo carrera del Nivel 5 sin fallar', 'assets/pictures/insigneas/proDescomposicion.png'),
('masterDescomposicion', 'Maestro de Descomposición', 'Consiguió ser Veloz y Pro en el Nivel 5 al mismo tiempo', 'assets/pictures/insigneas/masterDescomposicion.png')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO cat_horarios (nombre) VALUES ('Matutino'), ('Vespertino'), ('Nocturno') ON CONFLICT DO NOTHING;
INSERT INTO cat_periodos (nombre) VALUES ('Semestral'), ('Trimestral') ON CONFLICT DO NOTHING;

INSERT INTO cat_carreras (nombre) VALUES ('Ingeniería de Software'), ('Tecnología en Desarrollo Web'), ('Ingeniería en Sistemas') ON CONFLICT DO NOTHING;

INSERT INTO cat_materias (nombre, carrera_id) VALUES 
('ALGORITMOS Y LÓGICA DE PROGRAMACIÓN', 1),
('PROGRAMACIÓN ORIENTADA A OBJETOS', 1),
('ESTRUCTURA DE DATOS', 1),
('PROGRAMACIÓN ORIENTADA A EVENTOS', 1),
('DESARROLLO DE APLICACIONES WEB', 1),
('DESARROLLO DE APLICACIONES WEB AVANZADO', 1),
('DESARROLLO DE APLICACIONES MÓVILES', 1),
('INTELIGENCIA ARTIFICIAL', 1)
ON CONFLICT DO NOTHING;
`;

async function initializeDB() {
  try {
    console.log("⏳ Iniciando la creación de tablas y datos semilla...");
    await pool.query(initScript);
    console.log("✅ ¡Base de datos inicializada con éxito!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error inicializando la BD:", err);
    process.exit(1);
  }
}

initializeDB();