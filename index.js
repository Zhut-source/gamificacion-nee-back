const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const app = express();
app.use(cors({
    origin: ['https://tu-url-de-netlify.netlify.app', 'http://localhost:4200']
}));

app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool
  .connect()
  .then(() =>
    console.log("✅ Base de datos PostgreSQL conectada exitosamente."),
  )
  .catch((err) => console.error("❌ Error conectando a la BD", err.stack));

//# Ruta registro
app.post("/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

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
      "INSERT INTO usuarios (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role",
      [name, email, hashedPassword, role],
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

//# crear clase
app.post("/create-class", async (req, res) => {
  try {
    const { teacherId, name } = req.body;
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const newClass = await pool.query(
      "INSERT INTO aulas (name, code, teacher_id) VALUES ($1, $2, $3) RETURNING *",
      [name, code, teacherId],
    );
    res
      .status(201)
      .json({ message: "Clase creada con éxito", aula: newClass.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al crear la clase" });
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
    const aulaExists = await pool.query("SELECT id FROM aulas WHERE id = $1", [
      aulaId,
    ]);
    if (aulaExists.rows.length === 0)
      return res.status(404).json({ message: "Aula no encontrada" });
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
    const estudiantesMap = new Map();

    result.rows.forEach((row) => {
      if (!estudiantesMap.has(row.student_id)) {
        estudiantesMap.set(row.student_id, {
          id: row.student_id,
          name: row.name,
          email: row.email,
          hitosCompletados: new Set(),
          intentosPorNivelDif: {},
          ultima_actividad: row.fecha_intento || null,
          alerta: false,
        });
      }

      const estudiante = estudiantesMap.get(row.student_id);
      if (!row.nivel) return;

      const hitoKey = `${row.nivel}-${row.dificultad}`;

      if (row.estado === "completado") {
        estudiante.hitosCompletados.add(hitoKey);
      }

      if (!estudiante.intentosPorNivelDif[hitoKey]) {
        estudiante.intentosPorNivelDif[hitoKey] = [];
      }
      estudiante.intentosPorNivelDif[hitoKey].push(row.estado);
    });
    let sumaProgreso = 0;
    let estudiantesConDificultad = 0;
    const estudiantesArray = [];

    estudiantesMap.forEach((est) => {
      const porcentaje = Math.round((est.hitosCompletados.size / 15) * 100);
      est.progreso = porcentaje;
      sumaProgreso += porcentaje;

      for (const hito in est.intentosPorNivelDif) {
        const ultimosIntentos = est.intentosPorNivelDif[hito].slice(0, 3);
        if (
          ultimosIntentos.length >= 3 &&
          ultimosIntentos.every((e) => e !== "completado")
        ) {
          est.alerta = true;
          break;
        }
      }

      if (est.alerta) estudiantesConDificultad++;
      delete est.hitosCompletados;
      delete est.intentosPorNivelDif;

      estudiantesArray.push(est);
    });

    const totalEstudiantes = estudiantesArray.length;
    const progresoPromedio =
      totalEstudiantes > 0 ? Math.round(sumaProgreso / totalEstudiantes) : 0;

    res.json({
      kpis: { totalEstudiantes, progresoPromedio, estudiantesConDificultad },
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
    const nivelesDesglose = statsResult.rows.map((row) => {
      const completado = row.historial_estados.includes("completado");
      let estadoHito = completado ? "Completado" : "En progreso";
      const alerta =
        parseInt(row.total_intentos) >= 5 ||
        parseFloat(row.pistas_promedio) >= 5;
      if (alerta && !completado) {
        estadoHito = "Requiere apoyo";
      }

      return {
        nivel: row.nivel,
        nombre_nivel: `Nivel ${row.nivel}`,
        dificultad: row.dificultad,
        estado: estadoHito,
        intentos_realizados: parseInt(row.total_intentos),
        tiempo_promedio_segundos: parseInt(row.tiempo_promedio),
        pistas_promedio: parseFloat(row.pistas_promedio),
        tiene_alerta: alerta && !completado,
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor backend corriendo en http://localhost:${PORT}`);
});
