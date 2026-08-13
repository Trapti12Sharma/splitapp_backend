const transporter = require('../config/email');

const sendEmail = async ({ to, subject, html }) => {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'SplitApp <noreply@splitapp.com>',
      to,
      subject,
      html,
    });
  } catch (error) {
    console.error('Email sending failed:', error.message);
    // Don't throw - email failures shouldn't break the API
  }
};

const sendWelcomeEmail = async (user) => {
  await sendEmail({
    to: user.email,
    subject: 'Welcome to SplitApp!',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #6366f1;">Welcome to SplitApp, ${user.name}!</h1>
        <p>We're excited to have you on board. SplitApp makes it easy to split expenses with friends and groups.</p>
        <p>Here's what you can do:</p>
        <ul>
          <li>Add friends and track shared expenses</li>
          <li>Create groups for trips, roommates, and more</li>
          <li>Split bills equally, by percentage, exact amounts, or shares</li>
          <li>Settle up with ease</li>
        </ul>
        <p>Get started by adding your first friend or creating a group!</p>
        <p style="color: #6b7280; font-size: 12px;">SplitApp Team</p>
      </div>
    `,
  });
};

const sendFriendRequestEmail = async (receiver, requester) => {
  await sendEmail({
    to: receiver.email,
    subject: `${requester.name} sent you a friend request on SplitApp`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #6366f1;">New Friend Request</h2>
        <p>Hi ${receiver.name},</p>
        <p><strong>${requester.name}</strong> (@${requester.username}) wants to connect with you on SplitApp.</p>
        <p>Log in to accept or decline the request.</p>
        <p style="color: #6b7280; font-size: 12px;">SplitApp Team</p>
      </div>
    `,
  });
};

const sendPasswordResetEmail = async (user, resetUrl) => {
  await sendEmail({
    to: user.email,
    subject: 'Reset your SplitApp password',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #6366f1;">Password Reset Request</h2>
        <p>Hi ${user.name},</p>
        <p>You requested a password reset. Click the button below to reset your password:</p>
        <a href="${resetUrl}" style="
          display: inline-block;
          background-color: #6366f1;
          color: white;
          padding: 12px 24px;
          text-decoration: none;
          border-radius: 6px;
          margin: 16px 0;
        ">Reset Password</a>
        <p>This link expires in 1 hour. If you didn't request this, please ignore this email.</p>
        <p style="color: #6b7280; font-size: 12px;">SplitApp Team</p>
      </div>
    `,
  });
};

module.exports = { sendWelcomeEmail, sendFriendRequestEmail, sendPasswordResetEmail };
