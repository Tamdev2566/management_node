import "dotenv/config";
import nodemailer from "nodemailer";

// Lazy-initialized transporter
let transporter = null;

const getTransporter = async () => {
  if (transporter) return transporter;

  // 1. Check for real Gmail service credentials
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
    console.log("📧 [MailService] Configured with REAL Gmail SMTP:", process.env.EMAIL_USER);
    return transporter;
  }

  // 2. Check for custom SMTP configuration in environment
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });
    console.log("📧 [MailService] Configured with Custom SMTP:", process.env.SMTP_HOST);
    return transporter;
  }

  // 3. Fallback to Ethereal Sandbox (Development/Test Mode)
  console.log("ℹ️ [MailService] No real SMTP credentials (EMAIL_USER / EMAIL_PASS) configured in .env. Initializing Ethereal Sandbox preview...");
  try {
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    console.log("📧 [MailService] Running on Ethereal Test Mail Transport:", testAccount.user);
    return transporter;
  } catch (err) {
    console.warn("⚠️ [MailService] Network offline for Ethereal; using JSON log transport:", err.message);
    transporter = nodemailer.createTransport({
      jsonTransport: true,
    });
    return transporter;
  }
};

/**
 * Base Corporate MNC Email Template
 */
const renderCorporateEmailTemplate = ({
  badgeText,
  badgeBgColor,
  headline,
  recipientName,
  senderName,
  introMessage,
  taskDetails,
  remarks,
  ctaText,
  ctaUrl,
  footerNote,
}) => {
  const priorityColor =
    taskDetails.priority === "High"
      ? "#ef4444"
      : taskDetails.priority === "Low"
      ? "#10b981"
      : "#f59e0b";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${headline}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #1e293b;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      background-color: #f1f5f9;
      padding: 36px 0;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid #e2e8f0;
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05);
    }
    .header {
      background: #0f172a;
      padding: 24px 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .brand-title {
      color: #ffffff;
      font-size: 19px;
      font-weight: 800;
      letter-spacing: -0.02em;
      margin: 0;
    }
    .brand-sub {
      color: #94a3b8;
      font-size: 12px;
      margin: 2px 0 0 0;
    }
    .badge {
      display: inline-block;
      padding: 5px 12px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #ffffff;
      background-color: ${badgeBgColor || "#2563eb"};
    }
    .body-content {
      padding: 32px;
    }
    .greeting {
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 12px 0;
    }
    .intro {
      font-size: 14px;
      line-height: 1.6;
      color: #475569;
      margin: 0 0 24px 0;
    }
    .task-card {
      background-color: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .table-meta {
      width: 100%;
      border-collapse: collapse;
    }
    .table-meta td {
      padding: 8px 0;
      vertical-align: top;
      border-bottom: 1px solid #f1f5f9;
      font-size: 13px;
    }
    .table-meta tr:last-child td {
      border-bottom: none;
    }
    .meta-label {
      width: 35%;
      color: #64748b;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.03em;
    }
    .meta-value {
      width: 65%;
      color: #0f172a;
      font-weight: 600;
    }
    .remarks-box {
      background-color: #eff6ff;
      border-left: 4px solid #2563eb;
      padding: 14px 16px;
      border-radius: 0 8px 8px 0;
      margin-bottom: 24px;
      font-size: 13px;
      color: #1e3a8a;
      line-height: 1.5;
    }
    .cta-container {
      text-align: center;
      margin: 32px 0 16px 0;
    }
    .cta-btn {
      display: inline-block;
      background-color: #0f172a;
      color: #ffffff !important;
      text-decoration: none;
      padding: 12px 28px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: -0.01em;
      box-shadow: 0 2px 6px rgba(15, 23, 42, 0.15);
    }
    .footer {
      background-color: #f8fafc;
      padding: 24px 32px;
      border-top: 1px solid #e2e8f0;
      font-size: 11px;
      color: #94a3b8;
      line-height: 1.5;
    }
    .confidential-notice {
      margin-top: 10px;
      font-size: 10px;
      color: #cbd5e1;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <!-- Corporate Brand Header -->
      <table width="100%" cellpadding="0" cellspacing="0" class="header">
        <tr>
          <td>
            <h1 class="brand-title">TaskFlow Enterprise</h1>
            <p class="brand-sub">Sprint Delivery & Lifecycle System</p>
          </td>
          <td align="right">
            <span class="badge">${badgeText}</span>
          </td>
        </tr>
      </table>

      <!-- Main Notification Body -->
      <div class="body-content">
        <p class="greeting">Dear ${recipientName || "Team Member"},</p>
        <p class="intro">${introMessage}</p>

        <!-- Task Metadata Grid -->
        <div class="task-card">
          <table class="table-meta" cellpadding="0" cellspacing="0">
            <tr>
              <td class="meta-label">Task Reference</td>
              <td class="meta-value">#${taskDetails.taskId || "N/A"}</td>
            </tr>
            <tr>
              <td class="meta-label">Task Title</td>
              <td class="meta-value" style="color: #2563eb; font-weight: 700;">${taskDetails.title || "-"}</td>
            </tr>
            <tr>
              <td class="meta-label">Work Type</td>
              <td class="meta-value">${taskDetails.workType || "Task"}</td>
            </tr>
            <tr>
              <td class="meta-label">Priority</td>
              <td class="meta-value">
                <span style="color: ${priorityColor}; font-weight: 700;">● ${taskDetails.priority || "Medium"}</span>
              </td>
            </tr>
            <tr>
              <td class="meta-label">Estimated Hours</td>
              <td class="meta-value">${taskDetails.duration || 8} Hours</td>
            </tr>
            ${taskDetails.assignedBy ? `
            <tr>
              <td class="meta-label">Assigned By</td>
              <td class="meta-value">${taskDetails.assignedBy}</td>
            </tr>` : ""}
            ${taskDetails.assignedMember ? `
            <tr>
              <td class="meta-label">Developer</td>
              <td class="meta-value">${taskDetails.assignedMember}</td>
            </tr>` : ""}
            ${taskDetails.assignedTester ? `
            <tr>
              <td class="meta-label">QA Tester</td>
              <td class="meta-value">${taskDetails.assignedTester}</td>
            </tr>` : ""}
            ${taskDetails.timestamp ? `
            <tr>
              <td class="meta-label">Action Timestamp</td>
              <td class="meta-value">${taskDetails.timestamp}</td>
            </tr>` : ""}
          </table>
        </div>

        ${remarks ? `
        <div class="remarks-box">
          <strong>Notes / Remarks:</strong><br />
          ${remarks}
        </div>` : ""}

        <!-- Direct CTA -->
        <div class="cta-container">
          <a href="${ctaUrl || "http://localhost:3000/task"}" class="cta-btn" target="_blank">
            ${ctaText || "View Task in TaskFlow"} &rarr;
          </a>
        </div>
      </div>

      <!-- Compliance & Confidentiality Footer -->
      <div class="footer">
        <p style="margin: 0 0 6px 0;"><strong>TaskFlow Global IT Services</strong> &bull; Sprint Automation & Notification Engine</p>
        <p style="margin: 0;">This is an automated system notification. Please do not reply directly to this mail.</p>
        <p class="confidential-notice">
          <strong>CONFIDENTIALITY NOTICE:</strong> This email message, including any attachments, is intended solely for the named recipient(s) and may contain proprietary, confidential, or privileged information. Any unauthorized review, use, disclosure, or distribution is strictly prohibited.
        </p>
      </div>
    </div>
  </div>
</body>
</html>
  `;
};

/**
 * Universal Mail Dispatcher with logging
 */
const sendMailSafe = async ({ from, to, subject, html, text }) => {
  try {
    const client = await getTransporter();

    const mailOptions = {
      from,
      to,
      subject,
      html,
      text: text || "TaskFlow Notification",
    };

    const info = await client.sendMail(mailOptions);

    console.log("==================================================");
    console.log("📨 [MNC EMAIL TRIGGERED SUCCESSFULLY]");
    console.log("▶ From:   ", from);
    console.log("▶ To:     ", to);
    console.log("▶ Subject:", subject);
    console.log("▶ Message ID:", info.messageId);

    const testUrl = nodemailer.getTestMessageUrl(info);
    if (testUrl) {
      console.log("🔗 [Preview URL]:", testUrl);
    }
    console.log("==================================================");

    return {
      success: true,
      messageId: info.messageId,
      previewUrl: testUrl || null,
    };
  } catch (error) {
    console.error("❌ [MailService Error]:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * 1. Task Assigned to Developer
 * FROM: Assigner Email (Admin)
 * TO: Developer Email
 */
export const sendTaskAssignedEmail = async ({ task, assigner, assignee }) => {
  const fromAddress = `"${assigner.name || 'Admin'} (TaskFlow)" <${assigner.email || 'admin@taskflow.internal'}>`;
  const toAddress = `"${assignee.name}" <${assignee.email}>`;
  const subject = `[TaskFlow] Task Assigned: #${task.taskId} - ${task.title}`;

  const html = renderCorporateEmailTemplate({
    badgeText: "Task Assigned",
    badgeBgColor: "#2563eb",
    headline: "New Task Assigned",
    recipientName: assignee.name,
    senderName: assigner.name,
    introMessage: `A new sprint work item has been assigned to you by <strong>${assigner.name || "your Lead"}</strong>. Please review the requirements below and begin development in accordance with your sprint schedule.`,
    taskDetails: {
      taskId: task.taskId,
      title: task.title,
      workType: task.workType,
      priority: task.priority,
      duration: task.duration,
      assignedBy: `${assigner.name} (${assigner.email})`,
      assignedMember: `${assignee.name} (${assignee.position || "Developer"})`,
      timestamp: task.assignedDate || new Date().toLocaleString(),
    },
    remarks: task.description || "No specific instructions provided. Please refer to Jira/Sprint board.",
    ctaText: "Open Task & Start Work",
    ctaUrl: "http://localhost:3000/task",
  });

  return sendMailSafe({
    from: fromAddress,
    to: toAddress,
    subject,
    html,
  });
};

/**
 * 2. Developer Completes Work -> "Development Completed"
 * FROM: Developer Email
 * TO: Assigner / Admin Email
 */
export const sendWorkCompletedEmail = async ({ task, developer, assigner }) => {
  const fromAddress = `"${developer.name || 'Developer'} (TaskFlow)" <${developer.email || 'developer@taskflow.internal'}>`;
  const toAddress = `"${assigner.name || 'Admin'}" <${assigner.email || 'admin@taskflow.internal'}>`;
  const subject = `[TaskFlow] Development Completed: #${task.taskId} - ${task.title}`;

  const html = renderCorporateEmailTemplate({
    badgeText: "Development Completed",
    badgeBgColor: "#7c3aed",
    headline: "Development Work Completed",
    recipientName: assigner.name || "Lead",
    senderName: developer.name,
    introMessage: `Development work for Task <strong>#${task.taskId}</strong> has been completed by <strong>${developer.name}</strong>. The code has been checked in and is now ready for QA Testing Assignment.`,
    taskDetails: {
      taskId: task.taskId,
      title: task.title,
      workType: task.workType,
      priority: task.priority,
      duration: task.duration,
      assignedMember: `${developer.name} (${developer.email})`,
      assignedBy: assigner.name,
      timestamp: task.completedDate || new Date().toLocaleString(),
    },
    remarks: task.statusHistory?.[task.statusHistory.length - 1]?.remarks || "Development completed and verified on local environment.",
    ctaText: "Assign QA Tester",
    ctaUrl: "http://localhost:3000/task",
  });

  return sendMailSafe({
    from: fromAddress,
    to: toAddress,
    subject,
    html,
  });
};

/**
 * 3. QA Testing Assigned
 * FROM: Test Assigner / Admin Email
 * TO: QA Tester Email
 */
export const sendTestAssignedEmail = async ({ task, assigner, tester }) => {
  const fromAddress = `"${assigner.name || 'Testing Head'} (TaskFlow)" <${assigner.email || 'qa-lead@taskflow.internal'}>`;
  const toAddress = `"${tester.name}" <${tester.email}>`;
  const subject = `[TaskFlow] QA Testing Assigned: #${task.taskId} - ${task.title}`;

  const html = renderCorporateEmailTemplate({
    badgeText: "Testing Assigned",
    badgeBgColor: "#d97706",
    headline: "QA Verification Assigned",
    recipientName: tester.name,
    senderName: assigner.name,
    introMessage: `You have been assigned as the Quality Assurance Tester for Task <strong>#${task.taskId}</strong> by <strong>${assigner.name || "QA Lead"}</strong>. Please conduct test case execution and verify the feature before production release.`,
    taskDetails: {
      taskId: task.taskId,
      title: task.title,
      workType: task.workType,
      priority: task.priority,
      duration: task.duration,
      assignedBy: `${assigner.name} (${assigner.email})`,
      assignedMember: task.assignedMember || "Developer",
      assignedTester: `${tester.name} (${tester.position || "QA Tester"})`,
      timestamp: task.testAssignedDate || new Date().toLocaleString(),
    },
    remarks: `Developer: ${task.assignedMember || "N/A"}. Please verify functional test criteria on staging environment.`,
    ctaText: "Start QA Testing",
    ctaUrl: "http://localhost:3000/task",
  });

  return sendMailSafe({
    from: fromAddress,
    to: toAddress,
    subject,
    html,
  });
};

/**
 * 4. QA Testing Completed -> Ready for Live Deployment
 * FROM: QA Tester Email
 * TO: Admin / Assigner Email
 */
export const sendTestingCompletedEmail = async ({ task, tester, admin }) => {
  const fromAddress = `"${tester.name || 'QA Tester'} (TaskFlow)" <${tester.email || 'qa@taskflow.internal'}>`;
  const toAddress = `"${admin.name || 'Admin'}" <${admin.email || 'admin@taskflow.internal'}>`;
  const subject = `[TaskFlow] QA Testing Completed & Passed: #${task.taskId} - ${task.title}`;

  const html = renderCorporateEmailTemplate({
    badgeText: "Testing Completed",
    badgeBgColor: "#059669",
    headline: "QA Testing Verified & Passed",
    recipientName: admin.name || "Admin",
    senderName: tester.name,
    introMessage: `Quality Assurance testing for Task <strong>#${task.taskId}</strong> has passed successfully with all test cases verified by <strong>${tester.name}</strong>. The task is now eligible for Production Live Deployment.`,
    taskDetails: {
      taskId: task.taskId,
      title: task.title,
      workType: task.workType,
      priority: task.priority,
      duration: task.duration,
      assignedMember: task.assignedMember || "Developer",
      assignedTester: `${tester.name} (${tester.email})`,
      timestamp: task.testingCompletedDate || new Date().toLocaleString(),
    },
    remarks: task.testingRemarks || "All QA test cases passed. Staging regression verified. Ready for Production deployment.",
    ctaText: "Deploy to Live & Close Ticket",
    ctaUrl: "http://localhost:3000/task",
  });

  return sendMailSafe({
    from: fromAddress,
    to: toAddress,
    subject,
    html,
  });
};
