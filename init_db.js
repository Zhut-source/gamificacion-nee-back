// init_db.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  // Esta línea es VITAL para cuando subamos a Render/Neon:
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const initScript = `
-- 1. TABLAS BASE
CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    aula_id INTEGER
);

CREATE TABLE IF NOT EXISTS aulas (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    code VARCHAR(10) UNIQUE NOT NULL,
    teacher_id INTEGER REFERENCES usuarios(id),
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
    nivel INTEGER REFERENCES desafios(nivel) ON UPDATE CASCADE ON DELETE CASCADE,
    dificultad VARCHAR(20) CHECK (dificultad IN ('easy', 'medium', 'hard')),
    estado VARCHAR(20) CHECK (estado IN ('completado', 'fallido', 'abandonado')),
    tiempo_segundos INTEGER NOT NULL,
    pistas_utilizadas INTEGER DEFAULT 0,
    fecha_intento TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. DATOS SEMILLA (Seed Data)
-- Usamos ON CONFLICT DO NOTHING para que, si corres este script dos veces, no duplique la data.

INSERT INTO desafios (nivel, nombre, descripcion_nivel, descripcion_juego, objetivos) VALUES 
(1, 'Secuenciación', 'Aprende a dar instrucciones paso a paso en el orden correcto.', 'El robot explorador necesita llegar a la base de carga. Tu misión es darle las instrucciones correctas, paso a paso, para que no se estrelle.', '["Programa la ruta hasta la bandera verde.", "Usa los botones de dirección.", "Cuidado con los muros grises."]')
ON CONFLICT (nivel) DO NOTHING;

INSERT INTO desafios (nivel, nombre) VALUES 
(2, 'Patrones'),
(3, 'Repeticiones'),
(4, 'Condicionales'),
(5, 'Descomposición')
ON CONFLICT (nivel) DO NOTHING;

INSERT INTO insignias (codigo, nombre, descripcion, imagen_url) VALUES 
('lvl1_complete', 'Primer Paso', 'Completó el Nivel 1 en todas sus dificultades', 'assets/pictures/insigneas/primer_paso.jpg'),
('proTimer', 'Veloz', 'Completó el modo carrera en menos de 60 segundos', 'assets/pictures/insigneas/proTimer.jpg'),
('proSecuenciacion', 'Lógica Pro', 'Pasó el modo carrera sin fallar ni una sola vez', 'assets/pictures/insigneas/proSecuenciacion.jpg'),
('masterSecuenciacion', 'Imparable', 'Consiguió ser Veloz y Lógica Pro al mismo tiempo', 'assets/pictures/insigneas/masterSecuenciacion.jpg')
ON CONFLICT (codigo) DO NOTHING;
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