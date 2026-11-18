import "dotenv/config";
import express from "express";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import connectDB from "./config/db.js";

import User from "./models/User.js";
import Task from "./models/Task.js";
import Team from "./models/Team.js";
import Status from "./models/Status.js";
import {
  sendTaskAssignedEmail,
  sendWorkCompletedEmail,
  sendTestAssignedEmail,
  sendTestingCompletedEmail,
} from "./services/mailService.js";

const app = express();
const PORT = process.env.PORT || 5000;

const JWT_SECRET =
  process.env.JWT_SECRET ||
  "dasher_super_secret_jwt_key_9f8d7c6b5a4e3d2c1b0a_2026_production";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

// Helper: generate signed JWT Access Token
const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      employeeId: user.employeeId,
      username: user.username,
      email: user.email,
      userType: user.userType || "Employee",
      designation: user.designation,
      canCreateTask:
        user.userType === "Admin" ? true : Boolean(user.canCreateTask),
      super_Access: user.super_Access,
      create_work: user.create_work,
      assign_work: user.assign_work,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
};

// Middleware: Authenticate & Verify JWT Access Token
export const verifyToken = (req, res, next) => {
  const authHeader =
    req.headers["authorization"] || req.headers["Authorization"];

  if (!authHeader) {
    return res
      .status(401)
      .json({ error: "Access Denied: No Authorization Token Provided" });
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return res.status(401).json({
      error:
        "Access Denied: Malformed token format (Expected: Bearer <token>)",
    });
  }

  const token = parts[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res
        .status(401)
        .json({ error: "Session expired. Please log in again." });
    }
    return res
      .status(403)
      .json({ error: "Invalid or forged token. Access denied." });
  }
};

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Helper: generate next Employee ID
const generateEmployeeId = async () => {
  const users = await User.find({ employeeId: { $exists: true, $ne: "" } });
  let maxNum = 100;
  for (const u of users) {
    if (u.employeeId && u.employeeId.startsWith("EMP-")) {
      const num = parseInt(u.employeeId.replace("EMP-", ""), 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }
  }
  return `EMP-${maxNum + 1}`;
};

// Helper: generate next Task ID
const generateTaskId = async () => {
  const lastTask = await Task.findOne().sort({ taskId: -1 });
  if (lastTask && typeof lastTask.taskId === "number") {
    return lastTask.taskId + 1;
  }
  const count = await Task.countDocuments();
  return count + 1;
};

// Health Check
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// ==========================================
// AUTH & USER ROUTES
// ==========================================

// Register / Sign-up
app.post("/api/auth/register", async (req, res) => {
  try {
    const {
      username,
      pass,
      password,
      email,
      userType,
      designation,
      managedRoles,
      gender,
    } = req.body;
    const rawPass = password || pass;

    if (!username || !email || !rawPass) {
      return res
        .status(400)
        .json({ error: "Username, email, and password are required" });
    }

    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { username: username }],
    });

    if (existingUser) {
      return res
        .status(400)
        .json({ error: "User with this email or username already exists" });
    }

    const hashedPassword = await bcrypt.hash(rawPass, 10);
    const employeeId = req.body.employeeId || (await generateEmployeeId());
    const isUserAdmin = userType === "Admin";

    const parsedManagedRoles = Array.isArray(managedRoles)
      ? managedRoles
      : managedRoles
      ? [managedRoles]
      : [];

    const newUser = await User.create({
      username,
      email: email.toLowerCase(),
      pass: hashedPassword,
      userType: isUserAdmin ? "Admin" : "Employee",
      designation:
        designation || (isUserAdmin ? "Engineering Head" : "Team Member"),
      managedRoles: isUserAdmin ? parsedManagedRoles : [],
      canCreateTask: isUserAdmin ? true : false, // Admins can create tasks by default; employees cannot
      employeeId,
      gender: gender || "Male",
      super_Access: isUserAdmin,
      create_work: isUserAdmin,
      assign_work: isUserAdmin,
    });

    // Only Admin is automatically added into Team directory.
    // Regular employees are manually onboarded by Admin in Team Directory.
    if (isUserAdmin) {
      await Team.findOneAndUpdate(
        { employeeId },
        {
          employeeId,
          name: username,
          userType: "Admin",
          position: newUser.designation,
          managedRoles: newUser.managedRoles,
          canCreateTask: true,
          email: email.toLowerCase(),
          gender: gender || "Male",
          avatarSrc: "",
        },
        { upsert: true, new: true }
      );
    }

    res.status(201).json({
      message: `${newUser.userType} registered successfully 🎉`,
      data: {
        _id: newUser._id,
        username: newUser.username,
        email: newUser.email,
        userType: newUser.userType,
        designation: newUser.designation,
        managedRoles: newUser.managedRoles,
        canCreateTask: newUser.canCreateTask,
        employeeId: newUser.employeeId,
        gender: newUser.gender,
      },
      token: generateToken(newUser),
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ error: error.message });
  }
});

// User Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { userName, username, password, pass } = req.body;
    const userIdentifier = userName || username;
    const userPassword = password || pass;

    if (!userIdentifier || !userPassword) {
      return res
        .status(400)
        .json({ error: "Username and password are required" });
    }

    const escapedIdentifier = userIdentifier.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const user = await User.findOne({
      $or: [
        { username: { $regex: new RegExp(`^${escapedIdentifier}$`, "i") } },
        { email: userIdentifier.trim().toLowerCase() },
      ],
    });

    if (!user) {
      return res.status(401).json({ error: "Incorrect username or password" });
    }

    // Support bcrypt hash and plaintext fallback
    let isMatch = false;
    if (user.pass.startsWith("$2b$") || user.pass.startsWith("$2a$")) {
      isMatch = await bcrypt.compare(userPassword, user.pass);
    } else {
      isMatch = user.pass === userPassword;
      if (isMatch) {
        user.pass = await bcrypt.hash(userPassword, 10);
        await user.save();
      }
    }

    if (!isMatch) {
      return res.status(401).json({ error: "Incorrect username or password" });
    }

    // Ensure user has employeeId
    if (!user.employeeId) {
      user.employeeId = await generateEmployeeId();
      await user.save();
    }

    // Only Admin is automatically synced into Team.
    // Employees only exist in Team if Admin manually added them.
    if (user.userType === "Admin") {
      await Team.findOneAndUpdate(
        { employeeId: user.employeeId },
        {
          employeeId: user.employeeId,
          name: user.username,
          userType: "Admin",
          position: user.designation || "Engineering Head",
          managedRoles: user.managedRoles || [],
          canCreateTask: true,
          email: user.email,
          gender: user.gender || "Male",
        },
        { upsert: true }
      );
    } else {
      // If employee was already added by Admin, keep fields up-to-date without upserting
      await Team.findOneAndUpdate(
        { employeeId: user.employeeId },
        {
          name: user.username,
          position: user.designation || "Team Member",
          email: user.email,
          gender: user.gender || "Male",
        }
      );
    }

    res.json({
      message: "Login successful! 🎉",
      token: generateToken(user),
      data: {
        _id: user._id,
        username: user.username,
        email: user.email,
        userType: user.userType || "Employee",
        designation: user.designation,
        managedRoles: user.managedRoles || [],
        canCreateTask:
          user.userType === "Admin" ? true : Boolean(user.canCreateTask),
        employeeId: user.employeeId,
        super_Access: user.super_Access,
        create_work: user.create_work,
        assign_work: user.assign_work,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Verify & Get Current Authenticated User via JWT
app.get("/api/auth/me", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-pass");
    if (!user) {
      return res.status(404).json({ error: "User no longer exists" });
    }
    res.json({
      success: true,
      user: {
        id: user._id,
        employeeId: user.employeeId,
        username: user.username,
        email: user.email,
        userType: user.userType,
        designation: user.designation,
        canCreateTask: user.canCreateTask,
        managedRoles: user.managedRoles,
        gender: user.gender,
        super_Access: user.super_Access,
        create_work: user.create_work,
        assign_work: user.assign_work,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verify Old Password
app.post("/api/auth/verify-password", async (req, res) => {
  try {
    const { email, username, oldPassword } = req.body;
    if ((!email && !username) || !oldPassword) {
      return res
        .status(400)
        .json({ error: "Email/username and old password are required" });
    }

    const query = [];
    if (email) query.push({ email: email.toLowerCase() });
    if (username) query.push({ username: username });

    const user = await User.findOne({ $or: query });
    if (!user) {
      return res.status(404).json({ error: "User account not found" });
    }

    let isMatch = false;
    if (user.pass && (user.pass.startsWith("$2b$") || user.pass.startsWith("$2a$"))) {
      isMatch = await bcrypt.compare(oldPassword, user.pass);
    } else {
      isMatch = user.pass === oldPassword;
    }

    if (!isMatch) {
      return res
        .status(400)
        .json({ error: "Incorrect old password. Please try again." });
    }

    return res.json({
      success: true,
      message: "Password verified successfully! You can now set your new password.",
    });
  } catch (err) {
    console.error("verify-password error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// Verify Admin Credentials (Email & Password authentication for Admin access)
app.post("/api/auth/verify-admin", async (req, res) => {
  try {
    const { userEmail, email, userName, username, password, pass } = req.body;
    const identifier = userEmail || email || userName || username;
    const rawPass = password || pass;

    if (!identifier || !rawPass) {
      return res
        .status(400)
        .json({ error: "Admin email/username and password are required" });
    }

    const trimmed = identifier.trim();
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const user = await User.findOne({
      $or: [
        { username: { $regex: new RegExp(`^${escaped}$`, "i") } },
        { email: trimmed.toLowerCase() },
      ],
    });

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials. User not found." });
    }

    let isMatch = false;
    if (user.pass && (user.pass.startsWith("$2b$") || user.pass.startsWith("$2a$"))) {
      isMatch = await bcrypt.compare(rawPass, user.pass);
    } else {
      isMatch = user.pass === rawPass;
    }

    if (!isMatch) {
      return res.status(401).json({ error: "Incorrect password. Verification failed." });
    }

    if (user.userType !== "Admin") {
      return res.status(403).json({
        error: "Access Denied: The provided account is an Employee, not an authorized Administrator.",
      });
    }

    res.json({
      success: true,
      message: "Admin authentication verified successfully!",
      admin: {
        employeeId: user.employeeId,
        username: user.username,
        email: user.email,
        userType: user.userType,
        designation: user.designation,
      },
    });
  } catch (error) {
    console.error("Verify admin error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Change Password
app.post("/api/auth/change-password", async (req, res) => {
  try {
    const { email, username, oldPassword, newPassword } = req.body;
    if ((!email && !username) || !oldPassword || !newPassword) {
      return res
        .status(400)
        .json({ error: "All required password fields must be filled" });
    }

    if (newPassword.length < 4) {
      return res
        .status(400)
        .json({ error: "New password must be at least 4 characters long" });
    }

    const query = [];
    if (email) query.push({ email: email.toLowerCase() });
    if (username) query.push({ username: username });

    const user = await User.findOne({ $or: query });
    if (!user) {
      return res.status(404).json({ error: "User account not found" });
    }

    let isMatch = false;
    if (user.pass && (user.pass.startsWith("$2b$") || user.pass.startsWith("$2a$"))) {
      isMatch = await bcrypt.compare(oldPassword, user.pass);
    } else {
      isMatch = user.pass === oldPassword;
    }

    if (!isMatch) {
      return res
        .status(400)
        .json({ error: "Incorrect old password. Authentication failed." });
    }

    // Hash new password and save to DB
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.pass = hashedPassword;
    await user.save();

    return res.json({
      success: true,
      message: "Password updated successfully in database! Redirecting to login...",
    });
  } catch (err) {
    console.error("change-password error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// List Users
app.get("/api/users/list", async (req, res) => {
  try {
    const users = await User.find().select("-pass").sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete User
app.delete("/api/users/delete/:id", async (req, res) => {
  try {
    const id = req.params.id;
    let deleted = null;
    if (id.match(/^[0-9a-fA-F]{24}$/)) {
      deleted = await User.findByIdAndDelete(id);
    }
    if (!deleted) {
      deleted = await User.findOneAndDelete({ employeeId: id });
    }
    if (deleted && deleted.employeeId) {
      await Team.findOneAndDelete({ employeeId: deleted.employeeId });
    }
    res.json({ message: "User deleted successfully", deleted });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// ADMIN: TASK CREATION ACCESS MANAGEMENT
// ==========================================

// Get employees under this Admin's managed roles with task creation status
app.get("/api/admin/employees-access", async (req, res) => {
  try {
    const { adminEmpId } = req.query;
    if (!adminEmpId) {
      return res.status(400).json({ error: "adminEmpId is required" });
    }

    const admin = await User.findOne({ employeeId: adminEmpId });
    if (!admin || admin.userType !== "Admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const managedRoles = admin.managedRoles || [];

    // Filter employees: must be Employee type, and position/designation in managedRoles
    let query = { userType: "Employee" };
    if (managedRoles.length > 0) {
      query.position = { $in: managedRoles };
    }

    const teamEmployees = await Team.find(query).sort({ name: 1 });
    res.json({
      admin: {
        name: admin.username,
        designation: admin.designation,
        managedRoles: admin.managedRoles,
      },
      employees: teamEmployees,
    });
  } catch (error) {
    console.error("employees-access error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Grant or Revoke task creation permission for an employee
app.post("/api/admin/toggle-task-creation", async (req, res) => {
  try {
    const { employeeId, canCreateTask, adminEmpId } = req.body;

    if (!employeeId || adminEmpId === undefined) {
      return res
        .status(400)
        .json({ error: "employeeId and adminEmpId are required" });
    }

    const admin = await User.findOne({ employeeId: adminEmpId });
    if (!admin || admin.userType !== "Admin") {
      return res.status(403).json({ error: "Admin privileges required" });
    }

    // Verify employee belongs to admin's managed roles
    const targetTeam = await Team.findOne({ employeeId });
    if (!targetTeam) {
      return res.status(404).json({ error: "Employee not found" });
    }

    if (
      admin.managedRoles.length > 0 &&
      !admin.managedRoles.includes(targetTeam.position)
    ) {
      return res
        .status(403)
        .json({ error: "Employee is not in your managed organizational roles" });
    }

    const updatedUser = await User.findOneAndUpdate(
      { employeeId },
      { canCreateTask: Boolean(canCreateTask), create_work: Boolean(canCreateTask) },
      { new: true }
    );

    const updatedTeam = await Team.findOneAndUpdate(
      { employeeId },
      { canCreateTask: Boolean(canCreateTask) },
      { new: true }
    );

    res.json({
      message: `Task creation permission ${
        canCreateTask ? "granted to" : "revoked from"
      } ${updatedTeam.name}!`,
      employee: updatedTeam,
      canCreateTask: updatedUser.canCreateTask,
    });
  } catch (error) {
    console.error("toggle-task-creation error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Update User Profile (Head/Admin/Employee can update mail, gender, role/designation, username)
app.post("/api/user/update-profile", async (req, res) => {
  try {
    const { employeeId, id, email, gender, designation, role, username, name, managedRoles } = req.body;
    const targetEmpId = employeeId || id;

    if (!targetEmpId && !email) {
      return res.status(400).json({ error: "Employee ID or Email is required" });
    }

    const query = [];
    if (targetEmpId) query.push({ employeeId: targetEmpId });
    if (email) query.push({ email: email.toLowerCase() });

    const user = await User.findOne({ $or: query });
    if (!user) {
      return res.status(404).json({ error: "User account not found" });
    }

    const newUsername = (username || name || "").trim();
    const newEmail = (email || "").trim().toLowerCase();
    const newDesignation = (designation || role || "").trim();
    const newGender = gender;

    if (newUsername) user.username = newUsername;
    if (newEmail) user.email = newEmail;
    if (newGender) user.gender = newGender;
    if (newDesignation) user.designation = newDesignation;
    if (Array.isArray(managedRoles)) user.managedRoles = managedRoles;

    await user.save();

    // Sync in Team collection so Team Directory is always updated
    await Team.findOneAndUpdate(
      { employeeId: user.employeeId },
      {
        $set: {
          name: user.username,
          email: user.email,
          position: user.designation,
          gender: user.gender,
        },
      },
      { new: true }
    );

    res.json({
      success: true,
      message: "Profile updated successfully!",
      user: {
        _id: user._id,
        employeeId: user.employeeId,
        username: user.username,
        email: user.email,
        gender: user.gender,
        designation: user.designation,
        userType: user.userType,
        managedRoles: user.managedRoles,
        canCreateTask: user.canCreateTask,
        super_Access: user.super_Access,
      },
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// TEAM MANAGEMENT (Role-filtered for Admin)
// ==========================================

// List Team Members (Filtered by Admin's managedRoles)
app.get("/api/teams/list", async (req, res) => {
  try {
    const { adminEmpId } = req.query;

    if (adminEmpId) {
      const admin = await User.findOne({ employeeId: adminEmpId });
      if (admin && admin.userType === "Admin" && admin.managedRoles?.length > 0) {
        // Return only employees matching Admin's managedRoles
        const filtered = await Team.find({
          $or: [
            { position: { $in: admin.managedRoles } },
            { employeeId: admin.employeeId }, // include self
          ],
        }).sort({ createdAt: -1 });

        const formatted = filtered.map((m) => {
          const doc = m.toObject();
          doc.id = m.employeeId;
          return doc;
        });
        return res.json(formatted);
      }
    }

    // Default: return all teams
    const teams = await Team.find().sort({ createdAt: -1 });
    const formatted = teams.map((m) => {
      const doc = m.toObject();
      doc.id = m.employeeId;
      return doc;
    });
    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save or Update Team Member (Admin Only)
app.post("/api/teams/save", async (req, res) => {
  try {
    const { id, employeeId, name, position, email, gender, avatarSrc } =
      req.body;
    const empId = employeeId || id;

    if (!empId) {
      return res.status(400).json({ error: "Employee ID is required" });
    }

    const payload = {
      employeeId: empId,
      name,
      position: position || "Team Member",
      email,
      gender: gender || "Male",
      avatarSrc: avatarSrc || "",
    };

    const updatedTeam = await Team.findOneAndUpdate(
      { employeeId: empId },
      payload,
      {
        new: true,
        upsert: true,
      }
    );

    const doc = updatedTeam.toObject();
    doc.id = updatedTeam.employeeId;

    res.json({ message: "Team member saved successfully", data: doc });
  } catch (error) {
    console.error("Save team error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Delete Team Member (Admin Only)
app.delete("/api/teams/delete/:id", async (req, res) => {
  try {
    const id = req.params.id;
    let deleted = null;

    if (id.match(/^[0-9a-fA-F]{24}$/)) {
      deleted = await Team.findByIdAndDelete(id);
    }
    if (!deleted) {
      deleted = await Team.findOneAndDelete({ employeeId: id });
    }

    res.json({ message: "Team member deleted successfully", data: deleted });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get eligible assignees (Developers or Testers) mapped to an Admin
app.get("/api/admin/eligible-assignees", async (req, res) => {
  try {
    const { adminEmpId, roleCategory } = req.query; // roleCategory: 'developer' | 'tester'

    let admin = null;
    if (adminEmpId) {
      admin = await User.findOne({ employeeId: adminEmpId });
    }

    let managedRoles = admin?.managedRoles || [];

    // Filter by category if requested
    let eligible = await Team.find({ userType: { $ne: "Admin" } });

    if (managedRoles.length > 0) {
      eligible = eligible.filter((member) =>
        managedRoles.includes(member.position)
      );
    }

    if (roleCategory === "tester") {
      eligible = eligible.filter(
        (m) =>
          m.position.toLowerCase().includes("test") ||
          m.position.toLowerCase().includes("qa")
      );
    } else if (roleCategory === "developer") {
      eligible = eligible.filter(
        (m) =>
          !m.position.toLowerCase().includes("test") &&
          !m.position.toLowerCase().includes("qa")
      );
    }

    res.json(eligible);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// TASK ROUTES & WORKFLOW
// ==========================================

// List Tasks
app.get("/api/tasks/list", async (req, res) => {
  try {
    const tasks = await Task.find().sort({ createdAt: -1 });
    const formatted = tasks.map((t) => {
      const doc = t.toObject();
      doc.id = t.taskId || t._id;
      return doc;
    });
    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save or Update Task (Backend Permission Enforcement)
app.post("/api/tasks/save", async (req, res) => {
  try {
    const { _id, id, taskId, userEmpId, userType } = req.body;
    const taskPayload = { ...req.body };

    // Verify creator permission if creating a new task
    if (!_id && !taskId && !id) {
      if (userEmpId) {
        const creator = await User.findOne({ employeeId: userEmpId });
        if (creator && creator.userType !== "Admin" && !creator.canCreateTask) {
          return res.status(403).json({
            error:
              "Permission Denied: You do not have task creation permission. Please contact your Admin.",
          });
        }
      }
    }

    let existingTask = null;
    if (_id && _id.toString().match(/^[0-9a-fA-F]{24}$/)) {
      existingTask = await Task.findById(_id);
    } else if (taskId || (id && typeof id === "number")) {
      existingTask = await Task.findOne({ taskId: taskId || id });
    }

    if (existingTask) {
      // Permission verification: Only Admin OR the user who created this ticket can edit task details!
      let editor = null;
      if (userEmpId) {
        editor = await User.findOne({ employeeId: userEmpId });
      }
      if (!editor && req.body.userEmail) {
        editor = await User.findOne({ email: req.body.userEmail.toLowerCase() });
      }

      const isUserAdmin = editor
        ? editor.userType === "Admin"
        : userType === "Admin";

      const isTicketCreator = Boolean(
        (editor && existingTask.createdById && String(existingTask.createdById) === String(editor.employeeId)) ||
        (editor && existingTask.createdByEmail && existingTask.createdByEmail.toLowerCase() === editor.email.toLowerCase()) ||
        (editor && existingTask.createdBy && (
          existingTask.createdBy.toLowerCase() === editor.email.toLowerCase() ||
          existingTask.createdBy.toLowerCase() === (editor.userName || "").toLowerCase() ||
          existingTask.createdBy.toLowerCase() === (editor.name || "").toLowerCase()
        )) ||
        (req.body.userEmail && existingTask.createdByEmail && existingTask.createdByEmail.toLowerCase() === req.body.userEmail.toLowerCase()) ||
        (req.body.modifiedBy && existingTask.createdBy && existingTask.createdBy.toLowerCase() === req.body.modifiedBy.toLowerCase())
      );

      if (!isUserAdmin && !isTicketCreator) {
        return res.status(403).json({
          error: "Permission Denied: Only Admin and the user who created this ticket can edit task details.",
        });
      }

      // Preserve creator fields
      delete taskPayload.taskId;
      delete taskPayload.createdById;
      delete taskPayload.createdByEmail;
      delete taskPayload.createdBy;
      delete taskPayload.createdOn;

      Object.assign(existingTask, taskPayload);
      existingTask.modifiedOn = new Date();
      existingTask.modifiedBy = req.body.modifiedBy || (editor ? editor.name || editor.userName : "User");
      await existingTask.save();

      if (taskPayload.status) {
        await Status.updateMany(
          { taskId: existingTask.taskId },
          { taskStatus: taskPayload.status }
        );
      }

      return res.json({
        message: "Task updated successfully",
        data: existingTask,
      });
    }

    // Create New Task
    const newTaskId =
      taskId || (id && typeof id === "number" ? id : await generateTaskId());
    taskPayload.taskId = newTaskId;
    taskPayload.createdOn = taskPayload.createdOn || new Date();
    taskPayload.status = taskPayload.status || "Unassigned";

    let creatorDoc = null;
    if (userEmpId) {
      creatorDoc = await User.findOne({ employeeId: userEmpId });
    }
    if (!creatorDoc && req.body.userEmail) {
      creatorDoc = await User.findOne({ email: req.body.userEmail.toLowerCase() });
    }

    if (creatorDoc) {
      taskPayload.createdById = String(creatorDoc.employeeId);
      taskPayload.createdByEmail = creatorDoc.email;
      taskPayload.createdBy =
        taskPayload.createdBy || creatorDoc.name || creatorDoc.userName || creatorDoc.email;
    } else if (userEmpId) {
      taskPayload.createdById = String(userEmpId);
    }

    taskPayload.statusHistory = [
      {
        status: taskPayload.status,
        updatedBy: taskPayload.createdBy || "Admin",
        timestamp: new Date(),
        remarks: "Task created",
      },
    ];

    const newTask = await Task.create(taskPayload);
    const doc = newTask.toObject();
    doc.id = newTask.taskId;

    res.json({ message: "Task created successfully", data: doc });
  } catch (error) {
    console.error("Save task error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk Save Tasks (Excel upload)
app.post("/api/tasks/bulk-save", async (req, res) => {
  try {
    const { tasks, userEmpId } = req.body;

    if (userEmpId) {
      const creator = await User.findOne({ employeeId: userEmpId });
      if (creator && creator.userType !== "Admin" && !creator.canCreateTask) {
        return res.status(403).json({
          error: "Permission Denied: Only authorized users can upload tasks.",
        });
      }
    }

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ error: "Tasks array is required" });
    }

    let nextId = await generateTaskId();
    const createdTasks = [];

    for (const item of tasks) {
      const taskDoc = {
        taskId: item.id || nextId++,
        title: item.title || item.Title,
        description: item.description || item.Description || "",
        assignedMember: item.assignedMember || item.AssignedMember || "",
        priority: item.priority || item.Priority || "Medium",
        duration: item.duration || item.Duration || 0,
        workType: item.workType || item["Work Type"] || "Task",
        createdBy: item.createdBy || "Excel Upload",
        createdOn: new Date(),
        status: item.assignedMember ? "Assigned" : "Unassigned",
        statusHistory: [
          {
            status: item.assignedMember ? "Assigned" : "Unassigned",
            updatedBy: item.createdBy || "Excel Upload",
            timestamp: new Date(),
            remarks: "Imported via Excel",
          },
        ],
      };

      const saved = await Task.create(taskDoc);
      createdTasks.push(saved);
    }

    res.json({
      message: `${createdTasks.length} tasks imported successfully!`,
      data: createdTasks,
    });
  } catch (error) {
    console.error("Bulk save error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Step 1: Assign Task to Developer (Admin Only, Role-Filtered)
app.post("/api/tasks/assign", async (req, res) => {
  try {
    const { taskId, employeeId, assignedBy, adminEmpId } = req.body;

    if (!taskId || !employeeId) {
      return res
        .status(400)
        .json({ error: "taskId and employeeId are required" });
    }

    // Verify Admin permission and role mapping
    if (adminEmpId) {
      const admin = await User.findOne({ employeeId: adminEmpId });
      if (admin && admin.userType === "Admin" && admin.managedRoles?.length > 0) {
        const memberCheck = await Team.findOne({ employeeId });
        if (
          memberCheck &&
          !admin.managedRoles.includes(memberCheck.position)
        ) {
          return res.status(403).json({
            error: `Cannot assign task to ${memberCheck.name}: Role "${memberCheck.position}" is not in your managed roles.`,
          });
        }
      }
    }

    const member = await Team.findOne({ employeeId });
    if (!member) {
      return res.status(404).json({ error: "Team member not found" });
    }

    let task = await Task.findOne({ taskId: Number(taskId) });
    if (!task && taskId.toString().match(/^[0-9a-fA-F]{24}$/)) {
      task = await Task.findById(taskId);
    }

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    const assignedDateWithTime = new Date().toLocaleString();

    // Fetch Assigner user details
    let assignerDoc = null;
    if (adminEmpId) {
      assignerDoc = await User.findOne({ employeeId: adminEmpId });
    }
    if (!assignerDoc && assignedBy) {
      assignerDoc = await User.findOne({ username: assignedBy });
    }
    const assignerEmail = req.body.adminEmail || assignerDoc?.email || "admin@taskflow.internal";
    const assignerName = assignerDoc?.name || assignerDoc?.username || assignedBy || "Admin";

    // Update Task with email records
    task.status = "Assigned";
    task.assignedMember = member.name;
    task.assignedMemberId = member.employeeId;
    task.assignedMemberEmail = member.email;
    task.assignedBy = assignerName;
    task.assignedByEmail = assignerEmail;
    task.assignedDate = assignedDateWithTime;
    task.modifiedOn = new Date();
    task.statusHistory.push({
      status: "Assigned",
      updatedBy: assignerName,
      timestamp: new Date(),
      remarks: `Assigned to ${member.name} (${member.position})`,
    });
    await task.save();

    // Trigger Corporate MNC Task Assigned Email (From Assigner to Assignee)
    sendTaskAssignedEmail({
      task,
      assigner: { name: assignerName, email: assignerEmail },
      assignee: { name: member.name, email: member.email, position: member.position },
    }).catch((e) => console.error("Email trigger error:", e.message));

    // Create or update Status tracking record for Developer
    let statusEntry = await Status.findOne({
      taskId: task.taskId,
      employeeId: member.employeeId,
    });

    if (statusEntry) {
      statusEntry.taskStatus = "Assigned";
      statusEntry.dailyTrackerStatus = "Assigned";
      statusEntry.assignedDateWithTime = assignedDateWithTime;
      statusEntry.roleType = "developer";
      statusEntry.assignedMember = member.name;
      statusEntry.assignedMemberId = member.employeeId;
      statusEntry.devAssignedDate = assignedDateWithTime;
      await statusEntry.save();
    } else {
      statusEntry = await Status.create({
        employeeId: member.employeeId,
        name: member.name,
        position: member.position,
        email: member.email,
        gender: member.gender,
        avatarSrc: member.avatarSrc || "",
        taskId: task.taskId,
        taskTitle: task.title,
        taskStatus: "Assigned",
        assignedDateWithTime: assignedDateWithTime,
        dailyTrackerStatus: "Assigned",
        duration: task.duration ? `${task.duration}:00` : "08:00",
        estimatedHours: task.duration || 8,
        estimatedRemainingHours: `${task.duration || 8} hours`,
        loggedHours: 0,
        roleType: "developer",
        assignedMember: member.name,
        assignedMemberId: member.employeeId,
        devAssignedDate: assignedDateWithTime,
      });
    }

    res.json({
      message: `Task "${task.title}" successfully assigned to ${member.name}!`,
      task,
      status: statusEntry,
    });
  } catch (error) {
    console.error("Assign task error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Step 2: Developer Starts Work -> "Work In Progress"
app.post("/api/tasks/start-work", async (req, res) => {
  try {
    const { taskId, employeeId } = req.body;
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const formattedTime = `${pad(now.getDate())}/${pad(
      now.getMonth() + 1
    )}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const task = await Task.findOne({ taskId: Number(taskId) });
    if (!task) return res.status(404).json({ error: "Task not found" });

    task.status = "Work In Progress";
    task.startDate = formattedTime;
    task.statusHistory.push({
      status: "Work In Progress",
      updatedBy: employeeId || "Developer",
      timestamp: new Date(),
      remarks: "Work started by developer",
    });
    await task.save();

    await Status.updateMany(
      { taskId: Number(taskId) },
      {
        taskStatus: "Work In Progress",
        dailyTrackerStatus: "In Progress",
      }
    );

    if (employeeId) {
      await Status.findOneAndUpdate(
        { taskId: Number(taskId), employeeId },
        {
          startDate: formattedTime,
          taskStatus: "Work In Progress",
          dailyTrackerStatus: "In Progress",
        }
      );
    }

    res.json({ message: "Work marked as In Progress!", task });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Step 2 (cont'd): Developer Completes Work -> "Development Completed"
app.post("/api/tasks/work-completed", async (req, res) => {
  try {
    const { taskId, employeeId, remarks } = req.body;
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const formattedTime = `${pad(now.getDate())}/${pad(
      now.getMonth() + 1
    )}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const task = await Task.findOne({ taskId: Number(taskId) });
    if (!task) return res.status(404).json({ error: "Task not found" });

    task.status = "Development Completed";
    task.completedDate = formattedTime;
    task.statusHistory.push({
      status: "Development Completed",
      updatedBy: employeeId || "Developer",
      timestamp: new Date(),
      remarks: remarks || "Development work completed; ready for QA testing",
    });
    await task.save();

    await Status.updateMany(
      { taskId: Number(taskId) },
      {
        taskStatus: "Development Completed",
        dailyTrackerStatus: "Development Completed",
      }
    );

    if (employeeId) {
      await Status.findOneAndUpdate(
        { taskId: Number(taskId), employeeId },
        {
          completedDate: formattedTime,
          taskStatus: "Development Completed",
          developingStatus: true,
          dailyTrackerStatus: "Development Completed",
        }
      );
    }

    // Resolve Developer details
    let devDoc = null;
    if (employeeId) {
      devDoc = (await User.findOne({ employeeId })) || (await Team.findOne({ employeeId }));
    }
    const devEmail = req.body.employeeEmail || devDoc?.email || task.assignedMemberEmail || "developer@taskflow.internal";
    const devName = devDoc?.name || devDoc?.username || task.assignedMember || "Developer";

    // Resolve Assigner details
    let assignerDoc = null;
    if (task.assignedByEmail) {
      assignerDoc = await User.findOne({ email: task.assignedByEmail });
    }
    if (!assignerDoc && task.assignedBy) {
      assignerDoc = (await User.findOne({ username: task.assignedBy })) || (await Team.findOne({ name: task.assignedBy }));
    }
    const assignerEmail = task.assignedByEmail || assignerDoc?.email || "admin@taskflow.internal";
    const assignerName = task.assignedBy || assignerDoc?.name || "Admin";

    // Trigger Corporate MNC Development Completed Email (From Developer to Assigner)
    sendWorkCompletedEmail({
      task,
      developer: { name: devName, email: devEmail },
      assigner: { name: assignerName, email: assignerEmail },
    }).catch((e) => console.error("Work completed email error:", e.message));

    res.json({
      message:
        "Development Completed! Task is now ready for QA testing assignment.",
      task,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Step 3: Assign Task for Testing (Admin or Authorized User)
app.post("/api/tasks/test-assign", async (req, res) => {
  try {
    const { taskId, testerId, adminEmpId, assignedBy } = req.body;

    if (!taskId || !testerId) {
      return res
        .status(400)
        .json({ error: "taskId and testerId are required" });
    }

    const task = await Task.findOne({ taskId: Number(taskId) });
    if (!task) return res.status(404).json({ error: "Task not found" });

    // Workflow rule: Show / Allow Test Assign only after development is completed!
    if (
      task.status !== "Development Completed" &&
      task.status !== "Work Completed" &&
      task.status !== "Developing Completed"
    ) {
      return res.status(400).json({
        error:
          "Invalid workflow: Testing can only be assigned after Development is Completed.",
      });
    }

    const tester = await Team.findOne({ employeeId: testerId });
    if (!tester) {
      return res.status(404).json({ error: "Tester not found in team" });
    }

    // Role-mapping validation if Admin specified
    if (adminEmpId) {
      const admin = await User.findOne({ employeeId: adminEmpId });
      if (
        admin &&
        admin.userType === "Admin" &&
        admin.managedRoles?.length > 0 &&
        !admin.managedRoles.includes(tester.position)
      ) {
        return res.status(403).json({
          error: `Tester ${tester.name} (${tester.position}) is not in your managed roles.`,
        });
      }
    }

    const assignedTime = new Date().toLocaleString();

    // Fetch Test Assigner user details
    let testAssignerDoc = null;
    if (adminEmpId) {
      testAssignerDoc = await User.findOne({ employeeId: adminEmpId });
    }
    if (!testAssignerDoc && assignedBy) {
      testAssignerDoc = await User.findOne({ username: assignedBy });
    }
    const testAssignerEmail = req.body.adminEmail || testAssignerDoc?.email || "qa-lead@taskflow.internal";
    const testAssignerName = testAssignerDoc?.name || testAssignerDoc?.username || assignedBy || "QA Lead";

    task.status = "Testing Assigned";
    task.assignedTester = tester.name;
    task.assignedTesterId = tester.employeeId;
    task.assignedTesterEmail = tester.email;
    task.testAssignedBy = testAssignerName;
    task.testAssignedByEmail = testAssignerEmail;
    task.testAssignedDate = assignedTime;
    task.statusHistory.push({
      status: "Testing Assigned",
      updatedBy: testAssignerName,
      timestamp: new Date(),
      remarks: `Assigned for testing to ${tester.name} (${tester.position})`,
    });
    await task.save();

    // Trigger Corporate MNC QA Testing Assigned Email (From Assigner to QA Tester)
    sendTestAssignedEmail({
      task,
      assigner: { name: testAssignerName, email: testAssignerEmail },
      tester: { name: tester.name, email: tester.email, position: tester.position },
    }).catch((e) => console.error("Test assigned email error:", e.message));

    // Synchronize all existing Status tracking records for this task
    await Status.updateMany(
      { taskId: task.taskId },
      {
        taskStatus: "Testing Assigned",
        dailyTrackerStatus: "Testing Assigned",
        assignedTester: tester.name,
        assignedTesterId: tester.employeeId,
        testAssignedDate: assignedTime,
        assignedMember: task.assignedMember,
        assignedMemberId: task.assignedMemberId,
        devAssignedDate: task.assignedDate,
      }
    );

    // Create or update Status tracking record for Tester
    await Status.findOneAndUpdate(
      { taskId: task.taskId, employeeId: tester.employeeId },
      {
        employeeId: tester.employeeId,
        name: tester.name,
        position: tester.position,
        email: tester.email,
        gender: tester.gender,
        avatarSrc: tester.avatarSrc || "",
        taskId: task.taskId,
        taskTitle: task.title,
        taskStatus: "Testing Assigned",
        assignedDateWithTime: assignedTime,
        dailyTrackerStatus: "Assigned",
        duration: "04:00",
        estimatedHours: 4,
        estimatedRemainingHours: "4 hours",
        loggedHours: 0,
        roleType: "tester",
        assignedTester: tester.name,
        assignedTesterId: tester.employeeId,
        testAssignedDate: assignedTime,
        assignedMember: task.assignedMember,
        assignedMemberId: task.assignedMemberId,
        devAssignedDate: task.assignedDate,
      },
      { upsert: true, new: true }
    );

    res.json({
      message: `Task assigned to QA Tester ${tester.name} successfully!`,
      task,
    });
  } catch (error) {
    console.error("test-assign error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Step 4: Tester Starts Testing -> "Testing In Progress"
app.post("/api/tasks/start-testing", async (req, res) => {
  try {
    const { taskId, testerId } = req.body;
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const formattedTime = `${pad(now.getDate())}/${pad(
      now.getMonth() + 1
    )}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const task = await Task.findOne({ taskId: Number(taskId) });
    if (!task) return res.status(404).json({ error: "Task not found" });

    task.status = "Testing In Progress";
    task.statusHistory.push({
      status: "Testing In Progress",
      updatedBy: testerId || "Tester",
      timestamp: new Date(),
      remarks: "QA Testing started",
    });
    await task.save();

    await Status.updateMany(
      { taskId: Number(taskId) },
      {
        taskStatus: "Testing In Progress",
        dailyTrackerStatus: "In Progress",
      }
    );

    if (testerId) {
      await Status.findOneAndUpdate(
        { taskId: Number(taskId), employeeId: testerId },
        {
          startDate: formattedTime,
          taskStatus: "Testing In Progress",
          dailyTrackerStatus: "In Progress",
        }
      );
    }

    res.json({ message: "Testing is now In Progress!", task });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Step 4 (cont'd): Tester Completes Testing -> "Testing Completed"
app.post("/api/tasks/testing-completed", async (req, res) => {
  try {
    const { taskId, testerId, remarks } = req.body;
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const formattedTime = `${pad(now.getDate())}/${pad(
      now.getMonth() + 1
    )}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const task = await Task.findOne({ taskId: Number(taskId) });
    if (!task) return res.status(404).json({ error: "Task not found" });

    task.status = "Testing Completed";
    task.testingCompletedDate = formattedTime;
    task.testingRemarks = remarks || "QA Testing verified and passed.";
    task.statusHistory.push({
      status: "Testing Completed",
      updatedBy: testerId || "Tester",
      timestamp: new Date(),
      remarks: task.testingRemarks,
    });
    await task.save();

    await Status.updateMany(
      { taskId: Number(taskId) },
      {
        taskStatus: "Testing Completed",
        dailyTrackerStatus: "Testing Completed",
        testingCompletedDate: formattedTime,
        testingRemarks: task.testingRemarks,
      }
    );

    if (testerId) {
      await Status.findOneAndUpdate(
        { taskId: Number(taskId), employeeId: testerId },
        {
          completedDate: formattedTime,
          taskStatus: "Testing Completed",
          testingStatus: true,
          dailyTrackerStatus: "Completed",
          testingRemarks: task.testingRemarks,
        }
      );
    }

    // Resolve QA Tester details
    let testerDoc = null;
    if (testerId) {
      testerDoc = (await User.findOne({ employeeId: testerId })) || (await Team.findOne({ employeeId: testerId }));
    }
    const testerEmail = req.body.testerEmail || testerDoc?.email || task.assignedTesterEmail || "tester@taskflow.internal";
    const testerName = testerDoc?.name || testerDoc?.username || task.assignedTester || "QA Tester";

    // Resolve Test Assigner / Admin details
    let adminDoc = null;
    if (task.testAssignedByEmail) {
      adminDoc = await User.findOne({ email: task.testAssignedByEmail });
    }
    if (!adminDoc && task.testAssignedBy) {
      adminDoc = (await User.findOne({ username: task.testAssignedBy })) || (await Team.findOne({ name: task.testAssignedBy }));
    }
    const adminEmail = task.testAssignedByEmail || adminDoc?.email || task.assignedByEmail || "admin@taskflow.internal";
    const adminName = task.testAssignedBy || adminDoc?.name || "Admin";

    // Trigger Corporate MNC QA Testing Completed Email (From QA Tester to Admin)
    sendTestingCompletedEmail({
      task,
      tester: { name: testerName, email: testerEmail },
      admin: { name: adminName, email: adminEmail },
    }).catch((e) => console.error("Testing completed email error:", e.message));

    res.json({
      message:
        "Testing Completed! Task is now eligible for Live Deployment by Admin.",
      task,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Step 5: Live Deployment (Admin Only) -> Status MUST become "Closed"
app.post("/api/tasks/mark-live", async (req, res) => {
  try {
    const { taskId, adminEmpId, remarks, deployedBy } = req.body;

    // Verify Admin privilege
    if (adminEmpId) {
      const admin = await User.findOne({ employeeId: adminEmpId });
      if (!admin || admin.userType !== "Admin") {
        return res
          .status(403)
          .json({ error: "Only authorized Admins can mark tasks as Live Deployed." });
      }
    }

    const task = await Task.findOne({ taskId: Number(taskId) });
    if (!task) return res.status(404).json({ error: "Task not found" });

    // Workflow rule: Task must have Testing Completed!
    if (task.status !== "Testing Completed") {
      return res.status(400).json({
        error:
          "Invalid workflow: Task cannot be deployed to live before Testing is Completed.",
      });
    }

    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const formattedTime = `${pad(now.getDate())}/${pad(
      now.getMonth() + 1
    )}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    task.status = "Closed";
    task.liveDeployedDate = formattedTime;
    task.deployedBy = deployedBy || "Admin";
    task.statusHistory.push({
      status: "Closed",
      updatedBy: task.deployedBy,
      timestamp: new Date(),
      remarks: remarks || "Successfully deployed to production live environment. Ticket Closed.",
    });
    await task.save();

    await Status.updateMany(
      { taskId: Number(taskId) },
      {
        taskStatus: "Closed",
        dailyTrackerStatus: "Closed",
        liveDeployedDate: formattedTime,
        deployedBy: task.deployedBy,
      }
    );

    res.json({
      message: `Task #${task.taskId} "${task.title}" is deployed to Live and CLOSED! 🚀`,
      task,
    });
  } catch (error) {
    console.error("mark-live error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Delete Task (Admin Only)
app.delete("/api/tasks/delete/:id", async (req, res) => {
  try {
    const id = req.params.id;
    let deleted = null;

    if (id.match(/^[0-9a-fA-F]{24}$/)) {
      deleted = await Task.findByIdAndDelete(id);
    }
    if (!deleted) {
      const numId = Number(id);
      if (!isNaN(numId)) {
        deleted = await Task.findOneAndDelete({ taskId: numId });
      }
    }

    if (deleted) {
      await Status.deleteMany({ taskId: deleted.taskId });
    }

    res.json({ message: "Task deleted successfully", data: deleted });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// STATUS & TRACKING ROUTES
// ==========================================

// List Statuses (Employee sees only their tracking, Admin sees overall tracking)
app.get("/api/status/list", async (req, res) => {
  try {
    const { employeeId, userType } = req.query;
    let filter = {};

    if (userType && userType !== "Admin" && employeeId) {
      // Find tasks assigned to this employee as developer or tester
      const userTasks = await Task.find({
        $or: [
          { assignedMemberId: employeeId },
          { assignedTesterId: employeeId },
        ],
      }).select("taskId");
      const userTaskIds = userTasks.map((t) => t.taskId);

      filter = {
        $or: [
          { employeeId: employeeId },
          { assignedTesterId: employeeId },
          { taskId: { $in: userTaskIds } },
        ],
      };
    } else if (employeeId && !userType) {
      filter.employeeId = employeeId;
    }

    const statusList = await Status.find(filter).sort({ createdAt: -1 });
    const formatted = statusList.map((s) => {
      const doc = s.toObject();
      doc.id = s.employeeId;
      return doc;
    });
    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Overall Sprint Lifecycle Tracking: Merged developer and tester lifecycle per task
app.get("/api/status/tracking", async (req, res) => {
  try {
    const { employeeId, userType } = req.query;
    let taskFilter = {};

    if (userType && userType !== "Admin" && employeeId) {
      taskFilter = {
        $or: [
          { assignedMemberId: employeeId },
          { assignedTesterId: employeeId },
        ],
      };
    } else if (employeeId && !userType) {
      taskFilter = {
        $or: [
          { assignedMemberId: employeeId },
          { assignedTesterId: employeeId },
        ],
      };
    }

    const tasks = await Task.find(taskFilter).sort({ taskId: -1 });
    const taskIds = tasks.map((t) => t.taskId);

    // Fetch all related status records for these tasks
    const statusRecords = await Status.find({ taskId: { $in: taskIds } });

    const mergedList = tasks.map((t) => {
      const relatedStatuses = statusRecords.filter((s) => s.taskId === t.taskId);
      const devStatus = relatedStatuses.find(
        (s) => s.roleType === "developer" || (t.assignedMemberId && s.employeeId === t.assignedMemberId)
      );
      const testerStatus = relatedStatuses.find(
        (s) => s.roleType === "tester" || (t.assignedTesterId && s.employeeId === t.assignedTesterId)
      );

      return {
        taskId: t.taskId,
        taskTitle: t.title,
        taskStatus: t.status || "Assigned",
        status: t.status || "Assigned",
        assignedMember: t.assignedMember || devStatus?.assignedMember || devStatus?.name || "",
        assignedMemberId: t.assignedMemberId || devStatus?.assignedMemberId || devStatus?.employeeId || "",
        assignedDate: t.assignedDate || devStatus?.devAssignedDate || devStatus?.assignedDateWithTime || "",
        devAssignedDate: t.assignedDate || devStatus?.devAssignedDate || devStatus?.assignedDateWithTime || "",
        assignedDateWithTime: t.assignedDate || devStatus?.assignedDateWithTime || "",
        assignedTester: t.assignedTester || testerStatus?.assignedTester || testerStatus?.name || devStatus?.assignedTester || "",
        assignedTesterId: t.assignedTesterId || testerStatus?.assignedTesterId || testerStatus?.employeeId || devStatus?.assignedTesterId || "",
        testAssignedDate: t.testAssignedDate || testerStatus?.testAssignedDate || testerStatus?.assignedDateWithTime || devStatus?.testAssignedDate || "",
        liveDeployedDate: t.liveDeployedDate || devStatus?.liveDeployedDate || testerStatus?.liveDeployedDate || "",
        deployedBy: t.deployedBy || devStatus?.deployedBy || testerStatus?.deployedBy || "",
        createdOn: t.createdOn || t.createdAt,
      };
    });

    // Also include any tasks in Status that were not in Task collection
    const existingTaskIds = new Set(tasks.map((t) => t.taskId));
    let statusFilter = {};
    if (userType && userType !== "Admin" && employeeId) {
      statusFilter = {
        $or: [{ employeeId }, { assignedTesterId: employeeId }],
      };
    } else if (employeeId && !userType) {
      statusFilter = { employeeId };
    }
    const orphanStatuses = await Status.find(statusFilter);
    const orphanMap = new Map();
    orphanStatuses.forEach((s) => {
      if (!existingTaskIds.has(s.taskId)) {
        if (!orphanMap.has(s.taskId)) {
          orphanMap.set(s.taskId, []);
        }
        orphanMap.get(s.taskId).push(s);
      }
    });

    orphanMap.forEach((sList, orphanTaskId) => {
      const devStatus = sList.find((s) => s.roleType === "developer") || sList[0];
      const testerStatus = sList.find((s) => s.roleType === "tester");
      mergedList.push({
        taskId: orphanTaskId,
        taskTitle: devStatus.taskTitle || `Task #${orphanTaskId}`,
        taskStatus: (testerStatus || devStatus).taskStatus || "Assigned",
        status: (testerStatus || devStatus).taskStatus || "Assigned",
        assignedMember: devStatus.assignedMember || (devStatus.roleType === "developer" ? devStatus.name : ""),
        assignedMemberId: devStatus.assignedMemberId || devStatus.employeeId,
        assignedDate: devStatus.devAssignedDate || devStatus.assignedDateWithTime || "",
        devAssignedDate: devStatus.devAssignedDate || devStatus.assignedDateWithTime || "",
        assignedDateWithTime: devStatus.assignedDateWithTime || "",
        assignedTester: testerStatus?.assignedTester || testerStatus?.name || devStatus.assignedTester || "",
        assignedTesterId: testerStatus?.assignedTesterId || testerStatus?.employeeId || devStatus.assignedTesterId || "",
        testAssignedDate: testerStatus?.testAssignedDate || testerStatus?.assignedDateWithTime || devStatus.testAssignedDate || "",
        liveDeployedDate: devStatus.liveDeployedDate || testerStatus?.liveDeployedDate || "",
        deployedBy: devStatus.deployedBy || testerStatus?.deployedBy || "",
        createdOn: devStatus.createdOn || devStatus.createdAt,
      });
    });

    res.json(mergedList);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save or Update Status
app.post("/api/status/save", async (req, res) => {
  try {
    const { _id, taskId, employeeId } = req.body;
    let updatedStatus = null;

    if (_id && _id.toString().match(/^[0-9a-fA-F]{24}$/)) {
      updatedStatus = await Status.findByIdAndUpdate(_id, req.body, {
        new: true,
      });
    } else if (taskId && employeeId) {
      updatedStatus = await Status.findOneAndUpdate(
        { taskId: Number(taskId), employeeId },
        req.body,
        { new: true, upsert: true }
      );
    } else {
      updatedStatus = await Status.create(req.body);
    }

    res.json({ message: "Status saved successfully", data: updatedStatus });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Set Estimated Time
app.post("/api/status/set-time", async (req, res) => {
  try {
    const { taskId, employeeId, duration } = req.body;

    let hoursNum = 8;
    if (typeof duration === "string" && duration.includes(":")) {
      const parts = duration.split(":");
      hoursNum = parseFloat(parts[0]) + parseFloat(parts[1] || 0) / 60;
    } else if (typeof duration === "number") {
      hoursNum = duration;
    }

    const statusRecord = await Status.findOneAndUpdate(
      { taskId: Number(taskId), employeeId },
      {
        duration,
        estimatedHours: Math.round(hoursNum * 10) / 10,
        estimatedRemainingHours: `${Math.round(hoursNum * 10) / 10} hours`,
      },
      { new: true }
    );

    if (statusRecord) {
      await Task.findOneAndUpdate(
        { taskId: Number(taskId) },
        { duration: Math.round(hoursNum) }
      );
    }

    res.json({ message: "Estimated time updated!", data: statusRecord });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Log Daily Tracker Hours
app.post("/api/status/log-hours", async (req, res) => {
  try {
    const { taskId, employeeId, todayHours } = req.body;
    const entered = parseFloat(todayHours || 0);

    const statusRecord = await Status.findOne({
      taskId: Number(taskId),
      employeeId,
    });
    if (!statusRecord) {
      return res.status(404).json({ error: "Status record not found" });
    }

    const currentLogged = (statusRecord.loggedHours || 0) + entered;
    const est = statusRecord.estimatedHours || 8;
    const remaining = Math.max(est - currentLogged, 0);

    statusRecord.loggedHours = currentLogged;
    statusRecord.estimatedRemainingHours = `${remaining.toFixed(1)} hours`;
    if (remaining === 0) {
      statusRecord.dailyTrackerStatus = "Completed";
    } else {
      statusRecord.dailyTrackerStatus = "In Progress";
    }
    await statusRecord.save();

    res.json({
      message: "Daily hours logged successfully!",
      data: statusRecord,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete Status
app.delete("/api/status/delete/:id", async (req, res) => {
  try {
    const id = req.params.id;
    let deleted = null;
    if (id.match(/^[0-9a-fA-F]{24}$/)) {
      deleted = await Status.findByIdAndDelete(id);
    } else {
      deleted = await Status.findOneAndDelete({ taskId: Number(id) });
    }
    res.json({ message: "Status deleted successfully", data: deleted });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// DASHBOARD & ANALYTICS ROUTE
// ==========================================
app.get("/api/dashboard/stats", async (req, res) => {
  try {
    const tasks = await Task.find();
    const teams = await Team.find();
    const statuses = await Status.find();

    const totalTasks = tasks.length;
    const assignedTasks = tasks.filter((t) =>
      [
        "Assigned",
        "Work In Progress",
        "Development Completed",
        "Work Completed",
        "Testing Assigned",
        "Testing In Progress",
        "Testing Completed",
      ].includes(t.status)
    ).length;
    const unassignedTasks = tasks.filter(
      (t) => !t.status || t.status === "Unassigned"
    ).length;
    const completedTasks = tasks.filter((t) =>
      ["Completed", "Live Deployed", "Closed"].includes(t.status)
    ).length;

    // Priority summary
    const priorityCounts = { High: 0, Medium: 0, Low: 0 };
    tasks.forEach((t) => {
      if (t.priority && priorityCounts[t.priority] !== undefined) {
        priorityCounts[t.priority]++;
      }
    });

    // Status distribution
    const statusMap = {};
    tasks.forEach((t) => {
      const s = t.status || "Unassigned";
      statusMap[s] = (statusMap[s] || 0) + 1;
    });

    const statusDistribution = Object.entries(statusMap).map(
      ([name, value]) => ({
        name,
        value,
      })
    );

    // Team performance
    const teamPerformance = teams.map((member) => {
      const memberTasks = statuses.filter(
        (s) => s.employeeId === member.employeeId
      );
      const assigned = memberTasks.length;
      const completed = memberTasks.filter((s) =>
        ["Completed", "Live Deployed", "Work Completed"].includes(s.taskStatus)
      ).length;
      const pending = assigned - completed;
      const completionRate =
        assigned > 0 ? Math.round((completed / assigned) * 100) : 0;

      return {
        id: member.employeeId,
        name: member.name,
        userType: member.userType,
        position: member.position,
        email: member.email,
        avatarSrc: member.avatarSrc,
        assigned,
        completed,
        pending,
        completionRate,
      };
    });

    res.json({
      stats: {
        total: totalTasks,
        assigned: assignedTasks,
        unassigned: unassignedTasks,
        completed: completedTasks,
      },
      prioritySummary: {
        total: totalTasks,
        summary: priorityCounts,
        chartData: [
          { name: "High", value: priorityCounts.High },
          { name: "Medium", value: priorityCounts.Medium },
          { name: "Low", value: priorityCounts.Low },
        ],
      },
      statusDistribution,
      teamPerformance,
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// CALENDAR EVENTS ROUTE
// ==========================================
app.get("/api/events/list", async (req, res) => {
  try {
    const tasks = await Task.find();
    const events = [];

    tasks.forEach((task) => {
      const created = task.createdOn ? new Date(task.createdOn) : new Date();
      const end = new Date(created);
      end.setDate(
        end.getDate() + Math.max(Math.ceil((task.duration || 8) / 8), 1)
      );

      events.push({
        title: `[${task.priority || "Task"}] ${task.title}`,
        start: created,
        end: end,
        allDay: true,
        taskId: task.taskId,
        status: task.status,
        assignedMember: task.assignedMember,
        assignedTester: task.assignedTester,
      });
    });

    const now = new Date();
    events.push({
      title: "Sprint Standup Meeting",
      start: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 30),
      end: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0),
      allDay: false,
    });

    events.push({
      title: "Sprint QA & Deployment Review",
      start: new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 5,
        15,
        0
      ),
      end: new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 5,
        16,
        30
      ),
      allDay: false,
    });

    res.json(events);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// NOTIFICATIONS API
// ==========================================
app.get("/api/notifications", async (req, res) => {
  try {
    const { userEmpId, userEmail, userName, userType } = req.query;

    const notifications = [];
    const empIdStr = userEmpId ? String(userEmpId).trim() : "";
    const emailLower = userEmail ? String(userEmail).trim().toLowerCase() : "";
    const nameLower = userName ? String(userName).trim().toLowerCase() : "";

    // 1. Fetch recent tasks
    const allTasks = await Task.find().sort({ updatedAt: -1, createdOn: -1 }).limit(100);

    for (const t of allTasks) {
      const taskId = t.taskId || t._id;
      const assignedMemIdStr = t.assignedMemberId ? String(t.assignedMemberId).trim() : "";
      const assignedMemLower = t.assignedMember ? String(t.assignedMember).trim().toLowerCase() : "";

      const assignedTesterIdStr = t.assignedTesterId ? String(t.assignedTesterId).trim() : "";
      const assignedTesterLower = t.assignedTester ? String(t.assignedTester).trim().toLowerCase() : "";

      // Check Developer Assignment to this user
      const isAssignedDev = Boolean(
        (empIdStr && assignedMemIdStr === empIdStr) ||
        (emailLower && (assignedMemLower === emailLower || assignedMemLower.includes(emailLower))) ||
        (nameLower && (assignedMemLower === nameLower || assignedMemLower.includes(nameLower)))
      );

      if (isAssignedDev && t.assignedMember) {
        notifications.push({
          id: `dev-${taskId}-${t.assignedDate || t.updatedAt || ""}`,
          taskId: taskId,
          title: "New Task Assigned to You",
          taskTitle: t.title,
          role: "Developer",
          type: "dev_assignment",
          priority: t.priority || "Medium",
          status: t.status,
          assignedBy: t.assignedBy || "Admin",
          timestamp: t.assignedDate || t.updatedAt || t.createdOn || new Date(),
          message: `You were assigned as Developer for: "${t.title}"`,
        });
      }

      // Check QA Tester Assignment to this user
      const isAssignedTester = Boolean(
        (empIdStr && assignedTesterIdStr === empIdStr) ||
        (emailLower && (assignedTesterLower === emailLower || assignedTesterLower.includes(emailLower))) ||
        (nameLower && (assignedTesterLower === nameLower || assignedTesterLower.includes(nameLower)))
      );

      if (isAssignedTester && t.assignedTester) {
        notifications.push({
          id: `qa-${taskId}-${t.testAssignedDate || t.updatedAt || ""}`,
          taskId: taskId,
          title: "QA Testing Assigned to You",
          taskTitle: t.title,
          role: "QA Tester",
          type: "qa_assignment",
          priority: t.priority || "Medium",
          status: t.status,
          assignedBy: t.testAssignedBy || "Admin",
          timestamp: t.testAssignedDate || t.updatedAt || t.createdOn || new Date(),
          message: `You were assigned as QA Tester for: "${t.title}"`,
        });
      }

      // If Admin, also notify of tasks waiting for QA Test Assign or Live Deployment
      if (userType === "Admin") {
        if (["Development Completed", "Work Completed", "Developing Completed"].includes(t.status)) {
          notifications.push({
            id: `admin-qa-ready-${taskId}`,
            taskId: taskId,
            title: "Ready for Test Assignment",
            taskTitle: t.title,
            role: "Admin Action",
            type: "action_needed",
            priority: t.priority || "Medium",
            status: t.status,
            assignedBy: t.assignedMember || "Developer",
            timestamp: t.completedDate || t.updatedAt || new Date(),
            message: `Development completed on "${t.title}". Ready to assign QA Tester.`,
          });
        }
        if (t.status === "Testing Completed") {
          notifications.push({
            id: `admin-live-ready-${taskId}`,
            taskId: taskId,
            title: "Ready for Live Deployment",
            taskTitle: t.title,
            role: "Admin Action",
            type: "action_needed",
            priority: t.priority || "Medium",
            status: t.status,
            assignedBy: t.assignedTester || "Tester",
            timestamp: t.testingCompletedDate || t.updatedAt || new Date(),
            message: `Testing completed for "${t.title}". Ready for Live Deployment!`,
          });
        }
      }
    }

    // Sort notifications by timestamp descending
    notifications.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json(notifications);
  } catch (error) {
    console.error("Notifications error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Seed Initial Data Defaults & User Role Migration
const initDatabaseDefaults = async () => {
  try {
    // 1. Ensure existing users have userType, canCreateTask, and managedRoles
    const allUsers = await User.find();
    for (let i = 0; i < allUsers.length; i++) {
      const u = allUsers[i];
      let updated = false;

      if (!u.employeeId) {
        u.employeeId = `EMP-${101 + i}`;
        updated = true;
      }

      // Existing user Tamil defaults to Admin with full engineering roles managed
      if (!u.userType) {
        u.userType = "Admin";
        u.managedRoles = [
          "Frontend Developer",
          "Backend Developer",
          "Full Stack Developer",
          "UI/UX Designer",
          "QA Engineer",
          "Tester",
          "DevOps Engineer",
        ];
        u.canCreateTask = true;
        u.designation = u.designation || "Engineering Head";
        updated = true;
      }

      if (updated) {
        await u.save();
        console.log(
          `Updated user ${u.username} (${u.userType}): ${u.employeeId}`
        );
      }

      // Only Admin is automatically synced into Team.
      // Regular employees are onboarded manually by Admin via Team Directory.
      if (u.userType === "Admin") {
        await Team.findOneAndUpdate(
          { employeeId: u.employeeId },
          {
            employeeId: u.employeeId,
            name: u.username,
            userType: "Admin",
            position: u.designation,
            managedRoles: u.managedRoles,
            canCreateTask: true,
            email: u.email,
            gender: u.gender || "Male",
          },
          { upsert: true }
        );
      }
    }

    // 2. Ensure tasks have taskId and statusHistory
    const allTasks = await Task.find();
    for (let i = 0; i < allTasks.length; i++) {
      const t = allTasks[i];
      let modified = false;

      if (!t.taskId) {
        t.taskId = i + 1;
        modified = true;
      }
      if (!t.statusHistory || t.statusHistory.length === 0) {
        t.statusHistory = [
          {
            status: t.status || "Unassigned",
            updatedBy: t.createdBy || "System",
            timestamp: t.createdOn || new Date(),
            remarks: "Initial setup",
          },
        ];
        modified = true;
      }
      if (modified) {
        await t.save();
      }
    }
  } catch (err) {
    console.warn("DB sync warning:", err.message);
  }
};

const startServer = async () => {
  try {
    await connectDB();
    await initDatabaseDefaults();

    app.listen(PORT, () => {
      console.log(`✅ Server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error.message);
  }
};

startServer();
