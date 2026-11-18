import mongoose from "mongoose";

const statusSchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      required: true,
      index: true,
    },
    name: {
      type: String,
      default: "",
    },
    position: {
      type: String,
      default: "",
    },
    email: {
      type: String,
      default: "",
    },
    gender: {
      type: String,
      default: "Male",
    },
    avatarSrc: {
      type: String,
      default: "",
    },
    taskId: {
      type: Number,
      required: true,
      index: true,
    },
    taskTitle: {
      type: String,
      default: "",
    },
    taskStatus: {
      type: String,
      default: "Assigned",
    },
    assignedDateWithTime: {
      type: String,
      default: "",
    },
    startDate: {
      type: String,
      default: "",
    },
    completedDate: {
      type: String,
      default: "",
    },
    dailyTrackerStatus: {
      type: String,
      default: "Assigned",
    },
    duration: {
      type: String,
      default: "",
    },
    estimatedHours: {
      type: Number,
      default: 8,
    },
    estimatedRemainingHours: {
      type: String,
      default: "8 hours",
    },
    loggedHours: {
      type: Number,
      default: 0,
    },
    developingStatus: {
      type: Boolean,
      default: false,
    },
    testingStatus: {
      type: Boolean,
      default: false,
    },
    assignedTester: {
      type: String,
      default: "",
    },
    assignedTesterId: {
      type: String,
      default: "",
    },
    testAssignedDate: {
      type: String,
      default: "",
    },
    testingCompletedDate: {
      type: String,
      default: "",
    },
    testingRemarks: {
      type: String,
      default: "",
    },
    liveDeployedDate: {
      type: String,
      default: "",
    },
    deployedBy: {
      type: String,
      default: "",
    },
    roleType: {
      type: String,
      enum: ["developer", "tester"],
      default: "developer",
    },
    assignedMember: {
      type: String,
      default: "",
    },
    assignedMemberId: {
      type: String,
      default: "",
    },
    devAssignedDate: {
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
statusSchema.virtual("id").get(function () {
  return this.employeeId;
});

export default mongoose.model("Status", statusSchema);
