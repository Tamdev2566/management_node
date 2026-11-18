import mongoose from "mongoose";

const taskSchema = new mongoose.Schema(
  {
    taskId: {
      type: Number,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    // Developer Assignment
    assignedMember: {
      type: String,
      default: "",
    },
    assignedMemberId: {
      type: String,
      default: "",
    },
    assignedMemberEmail: {
      type: String,
      default: "",
    },
    assignedBy: {
      type: String,
      default: "",
    },
    assignedByEmail: {
      type: String,
      default: "",
    },
    assignedDate: {
      type: String,
      default: "",
    },
    // Tester Assignment
    assignedTester: {
      type: String,
      default: "",
    },
    assignedTesterId: {
      type: String,
      default: "",
    },
    assignedTesterEmail: {
      type: String,
      default: "",
    },
    testAssignedBy: {
      type: String,
      default: "",
    },
    testAssignedByEmail: {
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
    // Live Deployment
    liveDeployedDate: {
      type: String,
      default: "",
    },
    deployedBy: {
      type: String,
      default: "",
    },
    priority: {
      type: String,
      enum: ["Low", "Medium", "High"],
      default: "Medium",
    },
    duration: {
      type: Number,
      default: 0,
    },
    workType: {
      type: String,
      default: "Task",
    },
    createdBy: {
      type: String,
      default: "System",
    },
    createdById: {
      type: String,
      default: "",
    },
    createdByEmail: {
      type: String,
      default: "",
    },
    createdOn: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      default: "Unassigned",
    },
    attachment: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    requirementData: {
      type: String,
      default: "",
    },
    modifiedBy: {
      type: String,
      default: "",
    },
    modifiedOn: {
      type: Date,
      default: null,
    },
    startDate: {
      type: String,
      default: "",
    },
    completedDate: {
      type: String,
      default: "",
    },
    statusHistory: [
      {
        status: { type: String, required: true },
        updatedBy: { type: String, default: "" },
        timestamp: { type: Date, default: Date.now },
        remarks: { type: String, default: "" },
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual property so frontend can access task.id matching taskId or _id
taskSchema.virtual("id").get(function () {
  return this.taskId || this._id;
});

export default mongoose.model("Task", taskSchema);
