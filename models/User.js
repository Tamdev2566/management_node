import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      trim: true,
    },
    pass: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    userType: {
      type: String,
      enum: ["Admin", "Employee"],
      default: "Employee",
    },
    designation: {
      type: String,
      default: "Team Member",
    },
    managedRoles: {
      type: [String],
      default: [],
    },
    canCreateTask: {
      type: Boolean,
      default: false,
    },
    employeeId: {
      type: String,
      unique: true,
      sparse: true,
    },
    gender: {
      type: String,
      enum: ["Male", "Female", "Other"],
      default: "Male",
    },
    avatarSrc: {
      type: String,
      default: "",
    },
    super_Access: {
      type: Boolean,
      default: false,
    },
    create_work: {
      type: Boolean,
      default: false,
    },
    assign_work: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("User", userSchema);
