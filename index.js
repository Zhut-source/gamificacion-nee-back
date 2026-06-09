const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt'); 
const jwt = require('jsonwebtoken'); 
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

const pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
});

pool.connect()
    .then(() => console.log('✅ Base de datos PostgreSQL conectada exitosamente.'))
    .catch(err => console.error('❌ Error conectando a la BD', err.stack));


// RUTA DE REGISTRO
app.post('/register', async (req, res) => {
    try {
        const { name, email, password, role } = req.body;

        const userExists = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (userExists.rows.length > 0) {
            return res.status(400).json({ message: 'El correo ya está registrado.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = await pool.query(
            'INSERT INTO usuarios (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
            [name, email, hashedPassword, role]
        );

        res.status(201).json({ message: 'Usuario registrado con éxito', user: newUser.rows[0] });

    } catch (error) {
        console.error(error.message);
        res.status(500).json({ message: 'Error en el servidor' });
    }
});



//RUTA DE LOGIN

app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const userResult = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (userResult.rows.length === 0) {
            return res.status(401).json({ message: 'Correo o contraseña incorrectos' });
        }

        const user = userResult.rows[0];

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ message: 'Correo o contraseña incorrectos' });
        }

        const token = jwt.sign(
            { id: user.id, role: user.role }, 
            process.env.JWT_SECRET, 
            { expiresIn: '2h' } 
        );
        
        res.json({
            message: 'Login exitoso',
            token: token,
            user: { id: user.id, name: user.name, email: user.email, role: user.role }
        });

    } catch (error) {
        console.error(error.message);
        res.status(500).json({ message: 'Error en el servidor' });
    }
});

// ==========================================
// 3. ACTUALIZAR NOMBRE DE PERFIL
// ==========================================
app.put('/update-profile', async (req, res) => {
    try {
        const { id, name } = req.body;
        const result = await pool.query(
            'UPDATE usuarios SET name = $1 WHERE id = $2 RETURNING id, name, email, role',
            [name, id]
        );
        res.json({ message: 'Perfil actualizado', user: result.rows[0] });
    } catch (error) {
        res.status(500).json({ message: 'Error al actualizar perfil' });
    }
});

// ==========================================
// 4. CAMBIAR CONTRASEÑA
// ==========================================
app.put('/change-password', async (req, res) => {
    try {
        const { id, currentPassword, newPassword } = req.body;
        
        const userResult = await pool.query('SELECT * FROM usuarios WHERE id = $1', [id]);
        const user = userResult.rows[0];

        const validPassword = await bcrypt.compare(currentPassword, user.password);
        if (!validPassword) return res.status(401).json({ message: 'Contraseña actual incorrecta' });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        await pool.query('UPDATE usuarios SET password = $1 WHERE id = $2', [hashedPassword, id]);
        res.json({ message: 'Contraseña actualizada con éxito' });
    } catch (error) {
        res.status(500).json({ message: 'Error al cambiar contraseña' });
    }
});

// ==========================================
// 5. UNIRSE A UNA CLASE (ESTUDIANTE)
// ==========================================
app.post('/create-class', async (req, res) => {
    try {
        const { teacherId, name } = req.body;

        // Generar un código aleatorio de 6 caracteres (ej: XF93A2)
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();

        const newClass = await pool.query(
            'INSERT INTO aulas (name, code, teacher_id) VALUES ($1, $2, $3) RETURNING *',
            [name, code, teacherId]
        );

        res.status(201).json({ message: 'Clase creada con éxito', aula: newClass.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error al crear la clase' });
    }
});

// ==========================================
// 6. OBTENER LAS CLASES DE UN MAESTRO
// ==========================================
app.get('/teacher-classes/:teacherId', async (req, res) => {
    try {
        const { teacherId } = req.params;
        const classes = await pool.query(
            'SELECT * FROM aulas WHERE teacher_id = $1 ORDER BY created_at DESC',
            [teacherId]
        );
        res.json(classes.rows);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener las clases' });
    }
});

// ==========================================
// 7. UNIRSE A UNA CLASE (ESTUDIANTE) - ACTUALIZADO
// ==========================================
app.post('/join-class', async (req, res) => {
    try {
        const { studentId, code } = req.body;

        // 1. Buscar el aula por el código
        const aulaResult = await pool.query('SELECT * FROM aulas WHERE code = $1', [code]);
        
        if (aulaResult.rows.length === 0) {
            return res.status(404).json({ message: 'Código de clase inválido' });
        }

        const aula = aulaResult.rows[0];
        
        // 2. Asignar el aula al estudiante
        await pool.query('UPDATE usuarios SET aula_id = $1 WHERE id = $2', [aula.id, studentId]);

        res.json({ 
            message: `Te has unido exitosamente a: ${aula.name}`, 
            aula: aula 
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error al unirse a la clase' });
    }
});

// ==========================================
// 8. OBTENER EL AULA ACTUAL DEL ESTUDIANTE
// ==========================================
app.get('/student-class/:studentId', async (req, res) => {
    try {
        const { studentId } = req.params;
        
        // 1. Primero verificamos si el estudiante existe y si tiene un aula asignada
        const studentQuery = 'SELECT aula_id FROM usuarios WHERE id = $1';
        const studentResult = await pool.query(studentQuery, [studentId]);

        // Si el estudiante no existe en la BD, aquí SÍ corresponde un 404 real
        if (studentResult.rows.length === 0) {
            return res.status(404).json({ message: 'Estudiante no encontrado.' });
        }

        const aulaId = studentResult.rows[0].aula_id;

        // 2. Si el campo aula_id es NULL, el estudiante NO está unido a ninguna clase (Estado válido)
        if (aulaId === null) {
            return res.status(200).json(null); // Respondemos un 200 exitoso con un cuerpo null
        }
        
        // 3. Si tiene un aula_id, hacemos la consulta relacional con JOINs para traer los detalles
        const query = `
            SELECT a.name as aula_name, a.code, t.name as teacher_name 
            FROM usuarios s
            JOIN aulas a ON s.aula_id = a.id
            JOIN usuarios t ON a.teacher_id = t.id
            WHERE s.id = $1
        `;
        
        const result = await pool.query(query, [studentId]);
        
        // Por si acaso el aula fue eliminada físicamente pero el alumno retuvo el ID
        if (result.rows.length === 0) {
            return res.status(200).json(null); 
        }
        
        // Enviamos los datos del aula con HTTP 200
        res.status(200).json(result.rows[0]);

    } catch (error) {
        console.error('Error en GET /student-class:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

// ===================================================================
// 9. OBTENER MÉTRICAS Y LISTADO DE ESTUDIANTES PARA EL DASHBOARD
// ===================================================================
app.get('/teacher/classroom-metrics/:aulaId', async (req, res) => {
    try {
        const { aulaId } = req.params;

        // Validar aula
        const aulaExists = await pool.query('SELECT id FROM aulas WHERE id = $1', [aulaId]);
        if (aulaExists.rows.length === 0) return res.status(404).json({ message: 'Aula no encontrada' });

        // TRAER TODOS LOS ESTUDIANTES DEL AULA Y SUS INTENTOS (Uniendo tablas)
        const query = `
            SELECT 
                u.id as student_id, u.name, u.email,
                i.nivel, i.dificultad, i.estado, i.fecha_intento
            FROM usuarios u
            LEFT JOIN intentos_desafio i ON u.id = i.student_id
            WHERE u.aula_id = $1 AND u.role = 'estudiante'
            ORDER BY u.id, i.fecha_intento DESC;
        `;
        const result = await pool.query(query, [aulaId]);
        
        // PROCESAR LÓGICA DE NEGOCIO EN MEMORIA (Map-Reduce)
        const estudiantesMap = new Map();

        result.rows.forEach(row => {
            if (!estudiantesMap.has(row.student_id)) {
                estudiantesMap.set(row.student_id, {
                    id: row.student_id,
                    name: row.name,
                    email: row.email,
                    hitosCompletados: new Set(), // Usamos Set para evitar duplicados
                    intentosPorNivelDif: {}, // Para calcular los 3 fallos consecutivos
                    ultima_actividad: row.fecha_intento || null,
                    alerta: false
                });
            }

            const estudiante = estudiantesMap.get(row.student_id);
            if (!row.nivel) return; // Si no ha jugado nada, ignorar

            const hitoKey = `${row.nivel}-${row.dificultad}`;

            // 1. Contar Hitos Completados
            if (row.estado === 'completado') {
                estudiante.hitosCompletados.add(hitoKey);
            }

            // 2. Lógica "Requiere Apoyo": +3 fallos consecutivos en un hito
            if (!estudiante.intentosPorNivelDif[hitoKey]) {
                estudiante.intentosPorNivelDif[hitoKey] = [];
            }
            // Como ordenamos por fecha DESC en SQL, los primeros 3 del array son los más recientes
            estudiante.intentosPorNivelDif[hitoKey].push(row.estado);
        });

        // Dar formato final para Angular
        let sumaProgreso = 0;
        let estudiantesConDificultad = 0;
        const estudiantesArray = [];

        estudiantesMap.forEach(est => {
            // Calcular progreso X / 15
            const porcentaje = Math.round((est.hitosCompletados.size / 15) * 100);
            est.progreso = porcentaje;
            sumaProgreso += porcentaje;

            // Evaluar Alerta
            for (const hito in est.intentosPorNivelDif) {
                const ultimosIntentos = est.intentosPorNivelDif[hito].slice(0, 3);
                // Si hay 3 intentos o más, y TODOS los últimos 3 son fallidos o abandonados = ALERTA
                if (ultimosIntentos.length >= 3 && ultimosIntentos.every(e => e !== 'completado')) {
                    est.alerta = true;
                    break; 
                }
            }

            if (est.alerta) estudiantesConDificultad++;

            // Limpiar data innecesaria para el frontend
            delete est.hitosCompletados;
            delete est.intentosPorNivelDif;
            
            estudiantesArray.push(est);
        });

        const totalEstudiantes = estudiantesArray.length;
        const progresoPromedio = totalEstudiantes > 0 ? Math.round(sumaProgreso / totalEstudiantes) : 0;

        res.json({
            kpis: { totalEstudiantes, progresoPromedio, estudiantesConDificultad },
            estudiantes: estudiantesArray
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error interno' });
    }
});

// ===================================================================
// 10. OBTENER DESAFÍOS Y SU ESTADO PARA EL ESTUDIANTE
// ===================================================================
app.get('/student/challenges/:studentId', async (req, res) => {
    try {
        const { studentId } = req.params;

        // 1. Traer todos los niveles del catálogo
        const catalogResult = await pool.query('SELECT * FROM desafios ORDER BY nivel ASC');
        const desafios = catalogResult.rows;

        // 2. Buscar qué niveles Y qué dificultades ha completado exitosamente
        const progressResult = await pool.query(`
            SELECT nivel, dificultad 
            FROM intentos_desafio 
            WHERE student_id = $1 AND estado = 'completado'
            GROUP BY nivel, dificultad
        `, [studentId]);

        // 3. Agrupar el progreso. Ej: { 1: ['easy', 'medium', 'hard'], 2: ['easy'] }
        const progresoPorNivel = {};
        progressResult.rows.forEach(row => {
            if (!progresoPorNivel[row.nivel]) progresoPorNivel[row.nivel] = [];
            progresoPorNivel[row.nivel].push(row.dificultad);
        });

        // 4. Determinar cuál es el máximo nivel al que tiene acceso
        // Se empieza en 1. Si el 1 tiene 3 dificultades completadas, se desbloquea el 2, y así.
        let maxNivelDesbloqueado = 1;
        for (let n = 1; n <= 5; n++) {
            if (progresoPorNivel[n] && progresoPorNivel[n].length === 3) {
                maxNivelDesbloqueado = n + 1; 
            }
        }

        // 5. Construir el JSON para Angular
        const desafiosConEstado = desafios.map(desafio => {
            let status = 'locked'; // Por defecto

            // Si el nivel tiene 3 records, pasó todas las dificultades
            if (progresoPorNivel[desafio.nivel] && progresoPorNivel[desafio.nivel].length === 3) {
                status = 'completed'; 
            } 
            // Si el nivel es menor o igual al que logramos desbloquear, está disponible
            else if (desafio.nivel <= maxNivelDesbloqueado) {
                status = 'available'; 
            }

            return {
                ...desafio,
                status: status,
                // Opcional: le mandamos a Angular qué dificultades ya pasó de este nivel
                dificultades_completadas: progresoPorNivel[desafio.nivel] || [] 
            };
        });

        res.json(desafiosConEstado);

    } catch (error) {
        console.error('Error cargando desafíos del estudiante:', error);
        res.status(500).json({ message: 'Error interno' });
    }
});

// ===================================================================
// 11. [NUEVO] OBTENER DETALLES Y DESGLOSE INDIVIDUAL DE UN ESTUDIANTE
// ===================================================================
app.get('/teacher/student-details/:studentId', async (req, res) => {
    try {
        const { studentId } = req.params;

        // 1. Datos básicos del estudiante y su progreso total
        const userQuery = `
            SELECT u.name, u.email,
                   COUNT(DISTINCT CONCAT(i.nivel, i.dificultad)) FILTER (WHERE i.estado = 'completado') as hitos_logrados,
                   MAX(i.fecha_intento) as ultima_actividad
            FROM usuarios u
            LEFT JOIN intentos_desafio i ON u.id = i.student_id
            WHERE u.id = $1
            GROUP BY u.id;
        `;
        const userResult = await pool.query(userQuery, [studentId]);
        if (userResult.rows.length === 0) return res.status(404).json({ message: 'Estudiante no encontrado' });

        const userData = userResult.rows[0];

        // 2. Traer el historial agrupado por Nivel y Dificultad
        const statsQuery = `
            SELECT 
                nivel, 
                dificultad,
                COUNT(id) as total_intentos,
                ROUND(AVG(tiempo_segundos)) as tiempo_promedio,
                ROUND(AVG(pistas_utilizadas), 1) as pistas_promedio,
                -- Agregamos los arrays para analizar la alerta en JS
                array_agg(estado ORDER BY fecha_intento DESC) as historial_estados
            FROM intentos_desafio
            WHERE student_id = $1
            GROUP BY nivel, dificultad
            ORDER BY nivel ASC, 
                     CASE dificultad WHEN 'easy' THEN 1 WHEN 'medium' THEN 2 WHEN 'hard' THEN 3 END;
        `;
        const statsResult = await pool.query(statsQuery, [studentId]);

        // 3. Procesar las 15 filas potenciales
        const nivelesDesglose = statsResult.rows.map(row => {
            // Analizar estado general de ese hito
            const completado = row.historial_estados.includes('completado');
            let estadoHito = completado ? 'Completado' : 'En progreso';

            // Analizar Alerta: Últimos 3 intentos fallidos consecutivos OR usó 3+ pistas en promedio y no ha ganado
            const ultimos3 = row.historial_estados.slice(0, 3);
            const rachaMala = ultimos3.length >= 3 && ultimos3.every(e => e !== 'completado');
            const dependenciaPistas = Number(row.pistas_promedio) >= 3 && !completado; // Asumimos max 3 pistas

            let alerta = false;
            if (rachaMala || dependenciaPistas) {
                alerta = true;
                estadoHito = 'Requiere apoyo';
            }

            return {
                nivel: row.nivel,
                nombre_nivel: `Nivel ${row.nivel}`, // Aquí podrías mapear el nombre real de tu tabla de desafíos si quieres
                dificultad: row.dificultad,
                estado: estadoHito,
                intentos_realizados: parseInt(row.total_intentos),
                tiempo_promedio_segundos: parseInt(row.tiempo_promedio),
                pistas_promedio: parseFloat(row.pistas_promedio),
                tiene_alerta: alerta
            };
        });

        // Calcular progreso X / 15
        const hitos = parseInt(userData.hitos_logrados || 0);
        const progreso = Math.round((hitos / 15) * 100);

        res.json({
            perfil: {
                nombre: userData.name,
                email: userData.email,
                progreso_total_porcentaje: progreso,
                desafios_completados_texto: `${hitos} de 15 hitos`,
                ultima_actividad: userData.ultima_actividad
            },
            historial_niveles: nivelesDesglose
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error interno' });
    }
});

// ===================================================================
// 12. OBTENER DETALLE DE UN DESAFÍO ESPECÍFICO (Textos Dinámicos)
// ===================================================================
app.get('/student/challenge-detail/:studentId/:nivel', async (req, res) => {
    try {
        const { studentId, nivel } = req.params;
        
        // Traer textos del desafío
        const defResult = await pool.query('SELECT * FROM desafios WHERE nivel = $1', [nivel]);
        if (defResult.rows.length === 0) return res.status(404).json({ message: 'Nivel no encontrado' });
        const desafio = defResult.rows[0];

        // Traer qué dificultades ya pasó el alumno en este nivel
        const progResult = await pool.query(`
            SELECT dificultad FROM intentos_desafio 
            WHERE student_id = $1 AND nivel = $2 AND estado = 'completado'
            GROUP BY dificultad
        `, [studentId, nivel]);
        
        const completadas = progResult.rows.map(r => r.dificultad);
        
        res.json({
            ...desafio,
            dificultades_completadas: completadas,
            is_fully_completed: completadas.length === 3
        });
    } catch (error) {
        res.status(500).json({ message: 'Error interno' });
    }
});

// ===================================================================
// 13. GUARDAR INTENTO DE JUEGO (Al ganar, perder o abandonar)
// ===================================================================
app.post('/student/save-attempt', async (req, res) => {
    try {
        const { studentId, nivel, dificultad, estado, tiempo_segundos, pistas_utilizadas } = req.body;

        await pool.query(`
            INSERT INTO intentos_desafio 
            (student_id, nivel, dificultad, estado, tiempo_segundos, pistas_utilizadas) 
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [studentId, nivel, dificultad, estado, tiempo_segundos, pistas_utilizadas]);

        res.json({ success: true, message: 'Intento registrado' });
    } catch (error) {
        console.error('Error guardando intento:', error);
        res.status(500).json({ message: 'Error interno' });
    }
});



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor backend corriendo en http://localhost:${PORT}`);
});