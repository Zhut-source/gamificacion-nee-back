const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();

app.use(
  cors({
    origin: [
      "https://tranquil-speculoos-552c12.netlify.app",
      "http://localhost:4200",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.use(express.json());

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    }
  : {
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
    };

const pool = new Pool(poolConfig);

pool
  .connect()
  .then(() =>
    console.log("✅ Base de datos PostgreSQL conectada exitosamente."),
  )
  .catch((err) => console.error("❌ Error conectando a la BD", err.stack));

//# Ruta registro
app.post("/register", async (req, res) => {
  try {
    const { name, email, password, role, aula_id } = req.body;

    const userExists = await pool.query(
      "SELECT * FROM usuarios WHERE email = $1",
      [email],
    );
    if (userExists.rows.length > 0) {
      return res.status(400).json({ message: "El correo ya está registrado." });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = await pool.query(
      "INSERT INTO usuarios (name, email, password, role, aula_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role, aula_id",
      [name, email, hashedPassword, role, aula_id || null],
    );

    res
      .status(201)
      .json({ message: "Usuario registrado con éxito", user: newUser.rows[0] });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

//# Ruta login
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const userResult = await pool.query(
      "SELECT * FROM usuarios WHERE email = $1",
      [email],
    );
    if (userResult.rows.length === 0) {
      return res
        .status(401)
        .json({ message: "Correo o contraseña incorrectos" });
    }

    const user = userResult.rows[0];

    if (user.is_active === false) {
      return res.status(403).json({
        message: "Tu cuenta ha sido inhabilitada. Contacta al administrador.",
      });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res
        .status(401)
        .json({ message: "Correo o contraseña incorrectos" });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "2h" },
    );

    res.json({
      message: "Login exitoso",
      token: token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

//# actualizar profile
app.put("/update-profile", async (req, res) => {
  try {
    const { id, name } = req.body;
    const result = await pool.query(
      "UPDATE usuarios SET name = $1 WHERE id = $2 RETURNING id, name, email, role",
      [name, id],
    );
    res.json({ message: "Perfil actualizado", user: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: "Error al actualizar perfil" });
  }
});

//# cambiar contrasenia
app.put("/change-password", async (req, res) => {
  try {
    const { id, currentPassword, newPassword } = req.body;
    const userResult = await pool.query(
      "SELECT * FROM usuarios WHERE id = $1",
      [id],
    );
    const user = userResult.rows[0];
    const validPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validPassword)
      return res.status(401).json({ message: "Contraseña actual incorrecta" });
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    await pool.query("UPDATE usuarios SET password = $1 WHERE id = $2", [
      hashedPassword,
      id,
    ]);
    res.json({ message: "Contraseña actualizada con éxito" });
  } catch (error) {
    res.status(500).json({ message: "Error al cambiar contraseña" });
  }
});

//# obtener clases de 1 maestro
app.get("/teacher-classes/:teacherId", async (req, res) => {
  try {
    const { teacherId } = req.params;
    const classes = await pool.query(
      "SELECT * FROM aulas WHERE teacher_id = $1 ORDER BY created_at DESC",
      [teacherId],
    );
    res.json(classes.rows);
  } catch (error) {
    res.status(500).json({ message: "Error al obtener las clases" });
  }
});

//# unirse a una clase
app.post("/join-class", async (req, res) => {
  try {
    const { studentId, code } = req.body;
    const aulaResult = await pool.query("SELECT * FROM aulas WHERE code = $1", [
      code,
    ]);
    if (aulaResult.rows.length === 0) {
      return res.status(404).json({ message: "Código de clase inválido" });
    }
    const aula = aulaResult.rows[0];
    await pool.query("UPDATE usuarios SET aula_id = $1 WHERE id = $2", [
      aula.id,
      studentId,
    ]);
    res.json({
      message: `Te has unido exitosamente a: ${aula.name}`,
      aula: aula,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al unirse a la clase" });
  }
});

//# Ontener aula actual del estudainte
app.get("/student-class/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;
    const studentQuery = "SELECT aula_id FROM usuarios WHERE id = $1";
    const studentResult = await pool.query(studentQuery, [studentId]);
    if (studentResult.rows.length === 0) {
      return res.status(404).json({ message: "Estudiante no encontrado." });
    }

    const aulaId = studentResult.rows[0].aula_id;
    if (aulaId === null) {
      return res.status(200).json(null);
    }
    const query = `
            SELECT a.name as aula_name, a.code, t.name as teacher_name 
            FROM usuarios s
            JOIN aulas a ON s.aula_id = a.id
            JOIN usuarios t ON a.teacher_id = t.id
            WHERE s.id = $1
        `;
    const result = await pool.query(query, [studentId]);
    if (result.rows.length === 0) {
      return res.status(200).json(null);
    }
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Error en GET /student-class:", error);
    res.status(500).json({ message: "Error interno del servidor." });
  }
});

//# OBTENER MÉTRICAS Y LISTADO DE ESTUDIANTES PARA EL DASHBOARD
app.get("/teacher/classroom-metrics/:aulaId", async (req, res) => {
  try {
    const { aulaId } = req.params;
    const aulaExists = await pool.query("SELECT id FROM aulas WHERE id = $1", [aulaId]);
    if (aulaExists.rows.length === 0) return res.status(404).json({ message: "Aula no encontrada" });

    const query = `
            SELECT 
                u.id as student_id, u.name, u.email,
                i.nivel, i.dificultad, i.estado, i.pistas_utilizadas, i.fecha_intento
            FROM usuarios u
            LEFT JOIN intentos_desafio i ON u.id = i.student_id
            WHERE u.aula_id = $1 AND u.role = 'estudiante'
            ORDER BY u.id, i.fecha_intento ASC;
        `;
    const result = await pool.query(query, [aulaId]);
    const estudiantesMap = new Map();

    result.rows.forEach((row) => {
      if (!estudiantesMap.has(row.student_id)) {
        estudiantesMap.set(row.student_id, {
          id: row.student_id,
          name: row.name,
          email: row.email,
          hitosCompletados: new Set(),
          intentosPorHito: {}, 
          ultima_actividad: null,
          alerta: false,
        });
      }

      const estudiante = estudiantesMap.get(row.student_id);
      if (!row.nivel) return;

      const hitoKey = `${row.nivel}-${row.dificultad}`;
      estudiante.ultima_actividad = row.fecha_intento; 

      if (row.estado === "completado") {
        estudiante.hitosCompletados.add(hitoKey);
      }

      if (!estudiante.intentosPorHito[hitoKey]) {
        estudiante.intentosPorHito[hitoKey] = [];
      }
      
      estudiante.intentosPorHito[hitoKey].push({
         estado: row.estado,
         pistas: parseInt(row.pistas_utilizadas) || 0
      });
    });

    let estudiantesConDificultad = 0;
    let estudiantesBuenDesempeno = 0; // NUEVO KPI
    const estudiantesArray = [];

    estudiantesMap.forEach((est) => {
      const porcentaje = Math.round((est.hitosCompletados.size / 15) * 100);
      est.progreso = porcentaje;

      let tieneCompletados = false;
      let cumpleBuenDesempeno = true; // Asumimos que sí, hasta que se demuestre lo contrario

      for (const hito in est.intentosPorHito) {
        const historialHito = est.intentosPorHito[hito];
        const fallosTotales = historialHito.filter(i => i.estado !== 'completado').length;
        const yaEstaCompletado = historialHito.some(i => i.estado === 'completado');
        
        let alertaAtascado = false;
        if (fallosTotales >= 3 && !yaEstaCompletado) {
           alertaAtascado = true;
        }

        let alertaDependenciaPistas = false;
        if (yaEstaCompletado) {
           tieneCompletados = true;
           const ultimoExito = [...historialHito].reverse().find(i => i.estado === 'completado');
           if (ultimoExito && ultimoExito.pistas >= 3) {
              alertaDependenciaPistas = true;
           }
           const intentosTotales = historialHito.length;
           const pistasTotalesUsadas = historialHito.reduce((sum, item) => sum + item.pistas, 0);
           
           if (intentosTotales >= 3 || pistasTotalesUsadas > 0) {
               cumpleBuenDesempeno = false;
           }

        } else {
           const totalPistas = historialHito.reduce((sum, item) => sum + item.pistas, 0);
           const promedioPistas = historialHito.length > 0 ? totalPistas / historialHito.length : 0;
           if (promedioPistas >= 3) alertaDependenciaPistas = true;
        }

        if (alertaAtascado || alertaDependenciaPistas) {
          est.alerta = true;
        }
      }

      if (tieneCompletados && cumpleBuenDesempeno && !est.alerta) {
         estudiantesBuenDesempeno++;
      }

      if (est.alerta) estudiantesConDificultad++;
      
      delete est.hitosCompletados;
      delete est.intentosPorHito;

      estudiantesArray.push(est);
    });

    const totalEstudiantes = estudiantesArray.length;

    res.json({
      kpis: { totalEstudiantes, estudiantesBuenDesempeno, estudiantesConDificultad },
      estudiantes: estudiantesArray,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error interno" });
  }
});

//# OBTENER DESAFÍOS Y SU ESTADO PARA EL ESTUDIANTE
app.get("/student/challenges/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;
    const catalogResult = await pool.query(
      "SELECT * FROM desafios ORDER BY nivel ASC",
    );
    const desafios = catalogResult.rows;
    const progressResult = await pool.query(
      `
            SELECT nivel, dificultad 
            FROM intentos_desafio 
            WHERE student_id = $1 AND estado = 'completado'
            GROUP BY nivel, dificultad
        `,
      [studentId],
    );
    const progresoPorNivel = {};
    progressResult.rows.forEach((row) => {
      if (!progresoPorNivel[row.nivel]) progresoPorNivel[row.nivel] = [];
      progresoPorNivel[row.nivel].push(row.dificultad);
    });
    let maxNivelDesbloqueado = 1;
    for (let n = 1; n <= 5; n++) {
      if (progresoPorNivel[n] && progresoPorNivel[n].length === 3) {
        maxNivelDesbloqueado = n + 1;
      }
    }
    const desafiosConEstado = desafios.map((desafio) => {
      let status = "locked";

      if (
        progresoPorNivel[desafio.nivel] &&
        progresoPorNivel[desafio.nivel].length === 3
      ) {
        status = "completed";
      } else if (desafio.nivel <= maxNivelDesbloqueado) {
        status = "available";
      }

      return {
        ...desafio,
        status: status,
        dificultades_completadas: progresoPorNivel[desafio.nivel] || [],
      };
    });

    res.json(desafiosConEstado);
  } catch (error) {
    console.error("Error cargando desafíos del estudiante:", error);
    res.status(500).json({ message: "Error interno" });
  }
});

//# OBTENER DETALLES Y DESGLOSE INDIVIDUAL DE UN ESTUDIANTE
app.get("/teacher/student-details/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;
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
    if (userResult.rows.length === 0)
      return res.status(404).json({ message: "Estudiante no encontrado" });

    const userData = userResult.rows[0];
    
    // Traemos el historial con JSON_AGG para no perder la relación de cada partida individual
    const statsQuery = `
            SELECT 
                nivel, 
                dificultad,
                COUNT(id) as total_intentos,
                ROUND(AVG(tiempo_segundos)) as tiempo_promedio,
                ROUND(AVG(pistas_utilizadas), 1) as pistas_promedio,
                -- Agrupamos los objetos enteros (estado y pistas) ordenados por fecha ascendente
                json_agg(json_build_object('estado', estado, 'pistas', pistas_utilizadas) ORDER BY fecha_intento ASC) as historial
            FROM intentos_desafio
            WHERE student_id = $1
            GROUP BY nivel, dificultad
            ORDER BY nivel ASC, 
                     CASE dificultad WHEN 'easy' THEN 1 WHEN 'medium' THEN 2 WHEN 'hard' THEN 3 END;
        `;
    const statsResult = await pool.query(statsQuery, [studentId]);
    
    const nivelesDesglose = statsResult.rows.map((row) => {
      const historial = row.historial || [];
      const yaEstaCompletado = historial.some(i => i.estado === 'completado');
      let estadoHito = yaEstaCompletado ? "Completado" : "En progreso";
      
      let alerta = false;
      const fallosTotales = historial.filter(i => i.estado !== 'completado').length;

      // 1. Alerta por atasco
      if (fallosTotales >= 3 && !yaEstaCompletado) {
          alerta = true;
      }

      // 2. Alerta por pistas
      if (yaEstaCompletado) {
          // Buscamos su última victoria (el último objeto en el array que sea completado)
          const ultimoExito = [...historial].reverse().find(i => i.estado === 'completado');
          if (ultimoExito && ultimoExito.pistas >= 3) {
             alerta = true;
          }
      } else {
          // Si no ha ganado, evaluamos el promedio de pistas usadas hasta ahora
          if (parseFloat(row.pistas_promedio) >= 3) alerta = true;
      }

      // 3. Asignación del estado visual en la tabla del maestro
      if (alerta) {
        // Le mostramos un texto diferente al maestro según por qué está la alerta
        if (yaEstaCompletado) {
           estadoHito = "Aprobado con asistencia"; // Pasó, pero abusó de pistas
        } else {
           estadoHito = "Requiere apoyo"; // Está atascado y no ha podido pasar
        }
      }

      return {
        nivel: row.nivel,
        nombre_nivel: `Nivel ${row.nivel}`,
        dificultad: row.dificultad,
        estado: estadoHito,
        intentos_realizados: parseInt(row.total_intentos),
        tiempo_promedio_segundos: parseInt(row.tiempo_promedio),
        pistas_promedio: parseFloat(row.pistas_promedio),
        tiene_alerta: alerta,
      };
    });

    const hitos = parseInt(userData.hitos_logrados || 0);
    const progreso = Math.round((hitos / 15) * 100);

    res.json({
      perfil: {
        nombre: userData.name,
        email: userData.email,
        progreso_total_porcentaje: progreso,
        desafios_completados_texto: `${hitos} de 15 hitos`,
        ultima_actividad: userData.ultima_actividad,
      },
      historial_niveles: nivelesDesglose,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error interno" });
  }
});

// # OBTENER DETALLE DE UN DESAFÍO ESPECÍFICO (Textos Dinámicos)
app.get("/student/challenge-detail/:studentId/:nivel", async (req, res) => {
  try {
    const { studentId, nivel } = req.params;
    const defResult = await pool.query(
      "SELECT * FROM desafios WHERE nivel = $1",
      [nivel],
    );
    if (defResult.rows.length === 0)
      return res.status(404).json({ message: "Nivel no encontrado" });
    const desafio = defResult.rows[0];
    const progResult = await pool.query(
      `
            SELECT dificultad FROM intentos_desafio 
            WHERE student_id = $1 AND nivel = $2 AND estado = 'completado'
            GROUP BY dificultad
        `,
      [studentId, nivel],
    );

    const completadas = progResult.rows.map((r) => r.dificultad);

    res.json({
      ...desafio,
      dificultades_completadas: completadas,
      is_fully_completed: completadas.length === 3,
    });
  } catch (error) {
    res.status(500).json({ message: "Error interno" });
  }
});

//# 13. GUARDAR INTENTO DE JUEGO (Al ganar, perder o abandonar)
app.post("/student/save-attempt", async (req, res) => {
  try {
    const {
      studentId,
      nivel,
      dificultad,
      estado,
      tiempo_segundos,
      pistas_utilizadas,
    } = req.body;

    await pool.query(
      `
            INSERT INTO intentos_desafio 
            (student_id, nivel, dificultad, estado, tiempo_segundos, pistas_utilizadas) 
            VALUES ($1, $2, $3, $4, $5, $6)
        `,
      [
        studentId,
        nivel,
        dificultad,
        estado,
        tiempo_segundos,
        pistas_utilizadas,
      ],
    );

    res.json({ success: true, message: "Intento registrado" });
  } catch (error) {
    console.error("Error guardando intento:", error);
    res.status(500).json({ message: "Error interno" });
  }
});

// # GAMIFICACIÓN: OBTENER TODAS LAS INSIGNIAS DE UN ESTUDIANTE
app.get("/student/badges/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;
    const query = `
            SELECT i.id, i.codigo, i.nombre, i.descripcion, i.imagen_url,
                   CASE WHEN ie.id IS NOT NULL THEN true ELSE false END as unlocked
            FROM insignias i
            LEFT JOIN insignias_estudiante ie ON i.id = ie.insignia_id AND ie.student_id = $1
            ORDER BY i.id ASC;
        `;
    const result = await pool.query(query, [studentId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: "Error cargando insignias" });
  }
});

// # GAMIFICACIÓN: OTORGAR INSIGNIA AL ESTUDIANTE
app.post("/student/award-badge", async (req, res) => {
  try {
    const { studentId, badgeCode } = req.body;

    const badgeRes = await pool.query(
      "SELECT id FROM insignias WHERE codigo = $1",
      [badgeCode],
    );
    if (badgeRes.rows.length === 0)
      return res.status(404).json({ message: "Insignia no existe" });

    const badgeId = badgeRes.rows[0].id;

    await pool.query(
      "INSERT INTO insignias_estudiante (student_id, insignia_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [studentId, badgeId],
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: "Error otorgando insignia" });
  }
});

//# OBTENER CATÁLOGOS PARA CREAR AULA
app.get("/catalogs/creation-data", async (req, res) => {
  try {
    const horarios = await pool.query(
      "SELECT * FROM cat_horarios ORDER BY id ASC",
    );
    const periodos = await pool.query(
      "SELECT * FROM cat_periodos ORDER BY id ASC",
    );
    const carreras = await pool.query(
      "SELECT * FROM cat_carreras ORDER BY nombre ASC",
    );
    const materias = await pool.query(
      "SELECT * FROM cat_materias ORDER BY nombre ASC",
    );

    res.json({
      horarios: horarios.rows,
      periodos: periodos.rows,
      carreras: carreras.rows,
      materias: materias.rows,
    });
  } catch (error) {
    res.status(500).json({ message: "Error obteniendo catálogos" });
  }
});

//# MODIFICAR LA RUTA EXISTENTE DE CREATE-CLASS
app.post("/create-class", async (req, res) => {
  try {
    const {
      teacherId,
      horarioId,
      periodoId,
      carreraId,
      materiaId,
      nivel,
      aulaNum,
    } = req.body;

    // 1. Obtener los nombres reales para armar el título de la clase
    const matRes = await pool.query(
      "SELECT nombre FROM cat_materias WHERE id = $1",
      [materiaId],
    );
    const horRes = await pool.query(
      "SELECT nombre FROM cat_horarios WHERE id = $1",
      [horarioId],
    );
    const perRes = await pool.query(
      "SELECT nombre FROM cat_periodos WHERE id = $1",
      [periodoId],
    );
    const carRes = await pool.query(
      "SELECT nombre FROM cat_carreras WHERE id = $1",
      [carreraId],
    );

    const materiaNombre = matRes.rows[0].nombre;
    const horarioNombre = horRes.rows[0].nombre;
    const periodoNombre = perRes.rows[0].nombre;
    const carreraNombre = carRes.rows[0].nombre;

    let carreraAbbrev = "GEN";
    if (carreraNombre.toLowerCase().includes("software")) carreraAbbrev = "SOF";
    else if (carreraNombre.toLowerCase().includes("web")) carreraAbbrev = "TDW";
    else if (carreraNombre.toLowerCase().includes("sistemas"))
      carreraAbbrev = "SIS";
    else carreraAbbrev = carreraNombre.substring(0, 3).toUpperCase();

    const periodoAbbrev = periodoNombre.charAt(0).toUpperCase(); // S o T
    const horarioAbbrev = horarioNombre.substring(0, 2).toUpperCase();

    const className = `${carreraAbbrev}-${periodoAbbrev}-${horarioAbbrev}-${nivel}-${aulaNum}-${materiaNombre.toUpperCase()}`;

    const code = Math.random().toString(36).substring(2, 8).toUpperCase();

    // 4. Guardar en BD con las nuevas llaves foráneas
    const newClass = await pool.query(
      "INSERT INTO aulas (name, code, teacher_id, horario_id, periodo_id, materia_id, nivel, aula_num) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *",
      [
        className,
        code,
        teacherId,
        horarioId,
        periodoId,
        materiaId,
        nivel,
        aulaNum,
      ],
    );

    res
      .status(201)
      .json({ message: "Clase creada con éxito", aula: newClass.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al crear la clase" });
  }
});

//#[ADMIN] OBTENER KPIs GLOBALES DEL SISTEMA
app.get("/admin/global-kpis", async (req, res) => {
  try {
    // Ejecutamos varias consultas en paralelo para mayor velocidad
    const [usersRes, aulasRes, desafiosRes] = await Promise.all([
      pool.query("SELECT role, COUNT(*) FROM usuarios GROUP BY role"),
      pool.query("SELECT COUNT(*) FROM aulas"),
      pool.query("SELECT COUNT(*) FROM desafios"),
    ]);

    let totalEstudiantes = 0;
    let totalMaestros = 0;

    usersRes.rows.forEach((row) => {
      if (row.role === "estudiante") totalEstudiantes = parseInt(row.count);
      if (row.role === "maestro") totalMaestros = parseInt(row.count);
    });

    res.json({
      totalEstudiantes,
      totalMaestros,
      totalAulas: parseInt(aulasRes.rows[0].count),
      totalDesafios: parseInt(desafiosRes.rows[0].count),
    });
  } catch (error) {
    console.error("Error obteniendo KPIs de Admin:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

//#gestion de catalogos
app.get("/admin/catalogs", async (req, res) => {
  try {
    const horarios = await pool.query(
      "SELECT * FROM cat_horarios ORDER BY id ASC",
    );
    const periodos = await pool.query(
      "SELECT * FROM cat_periodos ORDER BY id ASC",
    );
    const carreras = await pool.query(
      "SELECT * FROM cat_carreras ORDER BY nombre ASC",
    );

    const materias = await pool.query(`
            SELECT m.id, m.nombre, c.nombre as carrera_nombre, m.carrera_id 
            FROM cat_materias m 
            JOIN cat_carreras c ON m.carrera_id = c.id 
            ORDER BY m.nombre ASC
        `);

    res.json({
      horarios: horarios.rows,
      periodos: periodos.rows,
      carreras: carreras.rows,
      materias: materias.rows,
    });
  } catch (error) {
    res.status(500).json({ message: "Error cargando catálogos" });
  }
});

// B. CREAR un nuevo registro (Endpoint genérico)
app.post("/admin/catalogs", async (req, res) => {
  try {
    const { tipo, nombre, carreraId } = req.body;

    let result;
    if (tipo === "horario") {
      result = await pool.query(
        "INSERT INTO cat_horarios (nombre) VALUES ($1) RETURNING *",
        [nombre],
      );
    } else if (tipo === "periodo") {
      result = await pool.query(
        "INSERT INTO cat_periodos (nombre) VALUES ($1) RETURNING *",
        [nombre],
      );
    } else if (tipo === "carrera") {
      result = await pool.query(
        "INSERT INTO cat_carreras (nombre) VALUES ($1) RETURNING *",
        [nombre],
      );
    } else if (tipo === "materia") {
      if (!carreraId)
        return res
          .status(400)
          .json({ message: "Las materias requieren una carrera" });
      result = await pool.query(
        "INSERT INTO cat_materias (nombre, carrera_id) VALUES ($1, $2) RETURNING *",
        [nombre, carreraId],
      );
    } else {
      return res.status(400).json({ message: "Tipo de catálogo inválido" });
    }

    res.status(201).json({ message: "Registro creado", item: result.rows[0] });
  } catch (error) {
    // Manejar errores de nombre duplicado
    if (error.code === "23505") {
      return res
        .status(400)
        .json({ message: "Ya existe un registro con este nombre" });
    }
    res.status(500).json({ message: "Error al crear registro" });
  }
});

// C. ELIMINAR un registro
app.delete("/admin/catalogs/:tipo/:id", async (req, res) => {
  try {
    const { tipo, id } = req.params;

    if (tipo === "horario")
      await pool.query("DELETE FROM cat_horarios WHERE id = $1", [id]);
    else if (tipo === "periodo")
      await pool.query("DELETE FROM cat_periodos WHERE id = $1", [id]);
    else if (tipo === "carrera")
      await pool.query("DELETE FROM cat_carreras WHERE id = $1", [id]);
    else if (tipo === "materia")
      await pool.query("DELETE FROM cat_materias WHERE id = $1", [id]);

    res.json({ success: true, message: "Registro eliminado" });
  } catch (error) {
    if (error.code === "23503") {
      return res.status(400).json({
        message: "No se puede eliminar porque está en uso por otros registros",
      });
    }
    res.status(500).json({ message: "Error eliminando el registro" });
  }
});

//#GESTIÓN DE AULAS Y DESVINCULACIÓN
//A
app.get("/admin/classrooms", async (req, res) => {
  try {
    const query = `
            SELECT 
                a.id, a.name as aula_nombre, a.code, a.created_at,
                m.name as maestro_nombre,
                c.nombre as carrera_nombre,
                p.nombre as periodo_nombre,
                (SELECT COUNT(*) FROM usuarios WHERE aula_id = a.id) as total_alumnos
            FROM aulas a
            LEFT JOIN usuarios m ON a.teacher_id = m.id
            LEFT JOIN cat_carreras c ON a.materia_id IN (SELECT id FROM cat_materias WHERE carrera_id = c.id) -- Inferimos carrera
            LEFT JOIN cat_periodos p ON a.periodo_id = p.id
            ORDER BY a.created_at DESC;
        `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error("Error cargando aulas (Admin):", error);
    res.status(500).json({ message: "Error cargando aulas" });
  }
});

// B
app.get("/admin/classrooms/:aulaId/students", async (req, res) => {
  try {
    const { aulaId } = req.params;
    const query = `
            SELECT id, name, email, created_at 
            FROM usuarios 
            WHERE aula_id = $1 AND role = 'estudiante'
            ORDER BY name ASC;
        `;
    const result = await pool.query(query, [aulaId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: "Error cargando estudiantes del aula" });
  }
});

// C.
app.put("/admin/students/:studentId/unlink", async (req, res) => {
  try {
    const { studentId } = req.params;
    await pool.query(
      "UPDATE usuarios SET aula_id = NULL WHERE id = $1 AND role = $2",
      [studentId, "estudiante"],
    );
    res.json({ success: true, message: "Estudiante desvinculado con éxito" });
  } catch (error) {
    res.status(500).json({ message: "Error al desvincular estudiante" });
  }
});

// D.
app.delete("/admin/classrooms/:aulaId", async (req, res) => {
  try {
    const { aulaId } = req.params;
    await pool.query("DELETE FROM aulas WHERE id = $1", [aulaId]);
    res.json({ success: true, message: "Aula eliminada con éxito" });
  } catch (error) {
    res.status(500).json({ message: "Error al eliminar el aula" });
  }
});

//# [ADMIN] GESTIÓN DE CONTENIDO PEDAGÓGICO (DESAFÍOS)
// A. Listar todos los desafíos ordenados por nivel
app.get("/admin/challenges", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM desafios ORDER BY nivel ASC",
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error cargando desafíos (Admin):", error);
    res.status(500).json({ message: "Error interno" });
  }
});

// B. Actualizar los textos y objetivos de un desafío
app.put("/admin/challenges/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, descripcion_nivel, descripcion_juego, objetivos } =
      req.body;
    const query = `
            UPDATE desafios 
            SET nombre = $1, 
                descripcion_nivel = $2, 
                descripcion_juego = $3, 
                objetivos = $4
            WHERE id = $5 
            RETURNING *;
        `;

    const result = await pool.query(query, [
      nombre,
      descripcion_nivel,
      descripcion_juego,
      JSON.stringify(objetivos),
      id,
    ]);

    if (result.rows.length === 0)
      return res.status(404).json({ message: "Desafío no encontrado" });

    res.json({
      success: true,
      message: "Contenido actualizado correctamente",
      challenge: result.rows[0],
    });
  } catch (error) {
    console.error("Error actualizando desafío:", error);
    res.status(500).json({ message: "Error interno actualizando" });
  }
});

//# [ADMIN] GESTIÓN DE USUARIOS (MODERACIÓN Y BANEO)
//A
app.get("/admin/users", async (req, res) => {
  try {
    // Excluimos a los administradores de la lista para que no se puedan banear entre ellos por error
    const query = `
            SELECT u.id, u.name, u.email, u.role, u.is_active, u.created_at,
                   a.name as aula_actual
            FROM usuarios u
            LEFT JOIN aulas a ON u.aula_id = a.id
            WHERE u.role != 'admin'
            ORDER BY u.role DESC, u.name ASC;
        `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: "Error cargando usuarios" });
  }
});

// B. Cambiar el estado de la cuenta (Suspender / Reactivar)
app.put("/admin/users/:id/toggle-status", async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body; // true = Activo, false = Baneado

    await pool.query(
      "UPDATE usuarios SET is_active = $1 WHERE id = $2 AND role != $3",
      [isActive, id, "admin"],
    );

    const actionText = isActive ? "reactivada" : "inhabilitada";
    res.json({ success: true, message: `Cuenta ${actionText} con éxito.` });
  } catch (error) {
    res.status(500).json({ message: "Error al cambiar estado de la cuenta" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor backend corriendo en http://localhost:${PORT}`);
});
