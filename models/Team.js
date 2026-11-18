import mongoose from "mongoose";

const teamSchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    userType: {
      type: String,
      enum: ["Admin", "Employee"],
      default: "Employee",
    },
    position: {
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
    email: {
      type: String,
      trim: true,
      lowercase: true,
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
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual id property returning employeeId
teamSchema.virtual("id").get(function () {
  return this.employeeId;
});

export default mongoose.model("Team", teamSchema);
