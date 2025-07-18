
const Student = require('../models/Student');
const Attendance = require('../models/Attendance');
const AttendanceSummary = require('../models/AttendanceSummary');
const mongoose = require('mongoose');
const Course = require('../models/Course');
const Subject = require('../models/Subject');
const emailService = require('../config/nodemailer');

// Get all subjects for a course and semester
exports.getSubjects = async (req, res) => {
  const { course, semester } = req.body;

  if (!course || !semester) {
    return res.status(400).json({ message: 'Course and semester are required' });
  }

  try {
    // Find course by Course_Name to get Course_ID
    const courseDoc = await Course.findOne({ Course_Name: course });
    if (!courseDoc) {
      return res.status(404).json({ message: 'Course not found' });
    }

    const subjects = await Subject.find({
      Course_ID: courseDoc.Course_Id,
      Sem_Id: semester
    });

    res.status(200).json(subjects);
  } catch (err) {
    console.error('Error fetching subjects:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Get students by course and semester
exports.getStudentsByCourseAndSemester = async (req, res) => {
  try {
    const { className, semester_id } = req.body;

    if (!className || !semester_id) {
      return res.status(400).json({ message: 'Class name and semester ID are required' });
    }

    // Step 1: Find the course using className (Course_Name)
    const course = await Course.findOne({ 
      Course_Name: className 
    });

    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }
   console.log('Course found:', course.Course_Id, 'for className:', className ,semester_id);
    // Step 2: Use Course_Id and semester_id to find students
    const students = await Student.find({ 
      courseId: course.Course_Id,
      semId: semester_id
    }).sort({ fullName: 1 });

    return res.status(200).json(students);
  } catch (error) {
    console.error('Error fetching students:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};


// Submit new attendance
const getCurrentAcademicYear = () => {
  const year = new Date().getFullYear();
  return `${year}-${(year + 1).toString().slice(-2)}`;
};


exports.submitAttendance = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { courseName, semId, subjectCode, date, attendance } = req.body;

    if (!courseName || !semId || !subjectCode || !date || !attendance) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    const course = await Course.findOne({ 
      Course_Name: courseName 
    });
    const courseId = course ? course.Course_Id : null;
console.log('Received attendance data:', courseId, semId, subjectCode, date, attendance);
    const academicYear = getCurrentAcademicYear();

    for (const record of attendance) {
      const { studentId, present } = record;
      if (!studentId) continue;
console.log('Processing attendance for student:', studentId, 'Present:', present);
      // Store attendance detail
     await Attendance.updateOne(
  {
    studentId,
    subjectCode
  },
  {
    $setOnInsert: { studentId, subjectCode }, // ensures document is created
    $push: {
      records: {
        date: new Date(date),
        present
      }
    }
  },
  { upsert: true, session }
);

console.log('Attendance record updated for student:', studentId);
      // Update or create summary
      let summary = await AttendanceSummary.findOne({
        studentId,
        courseId,
        semId,
        subjectCode,
        academicYear
      }).session(session);
console.log('Attendance summary found:', summary ? 'Yes' : 'No', 'for student:', studentId);
      if (!summary) {
        summary = new AttendanceSummary({
          studentId,
          courseId,
          semId,
          subjectCode,
          academicYear,
          totalClasses: 1,
          attendedClasses: present ? 1 : 0,
          attendancePercentage: present ? 100 : 0
        });
        console.log('New attendance summary created for student:', studentId);
      } else {
        summary.totalClasses += 1;
        if (present) summary.attendedClasses += 1;
        summary.attendancePercentage = parseFloat(
          ((summary.attendedClasses / summary.totalClasses) * 100).toFixed(2)
        );
        summary.lastUpdated = new Date();
      }

      await summary.save({ session });
    }

    await session.commitTransaction();
    session.endSession();
    return res.status(201).json({ message: 'Attendance submitted successfully' });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Error submitting attendance:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// New controller method to get attendance by course, semester, subject, and academic year
exports.getAttendanceByCourseAndSubject = async (req, res) => {
  try {
    const { course, semester, subject, academicYear } = req.body;
    console.log('Query params:', { course, semester, subject, academicYear });

    // Step 1: Fetch students for the given course and semester
    const students = await Student.find({
      courseId: course,
      semId: semester
    });

    if (students.length === 0) {
      return res.status(404).json({ message: 'No students found for this course and semester' });
    }

    const attendanceSummaries = [];

    // Step 2: For each student, fetch their attendance record
    for (const student of students) {
      const attendanceDoc = await Attendance.findOne({
        studentId: student._id,
        subjectCode: subject
      });

      let attended = 0;
      const total = attendanceDoc?.records?.length || 0;

      attendanceDoc?.records?.forEach(record => {
        if (record.present) attended++;
      });

      console.log(`Attendance for student ${student.fullName} (${student._id}): ${attended}/${total}`);

      attendanceSummaries.push({
        studentId: student._id,
        studentName: student.fullName,
        rollNumber: student.rollNumber,
        courseId: student.courseId,
        semId: student.semId,
        subjectCode: subject,
        academicYear,
        classesAttended: attended,
        totalClasses: total,
        attendancePercentage: total > 0 ? Math.round((attended / total) * 100) : 0
      });
    }

    return res.status(200).json(attendanceSummaries);
  } catch (error) {
    console.error('Error fetching attendance by course and subject:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};


exports.getStudentAttendanceDetail = async (req, res) => {
  try {
    const { studentId, subject, semester, academicYear } = req.params;

    console.log('Query params:', { studentId, subject, semester, academicYear });

    const query = {
      studentId: new mongoose.Types.ObjectId(studentId), // Important: convert string to ObjectId
      subjectCode: subject.trim()                        // Remove accidental whitespace
    };

    console.log('MongoDB query:', JSON.stringify(query));

    const attendanceDoc = await Attendance.findOne(query);

    if (!attendanceDoc || !attendanceDoc.records || attendanceDoc.records.length === 0) {
      console.log("No attendance records found");
      return res.status(404).json({ 
        message: 'No attendance records found',
        query
      });
    }

    const formattedRecords = attendanceDoc.records.map(record => ({
      date: record.date,
      present: record.present
    }));

    return res.status(200).json(formattedRecords);
  } catch (error) {
    console.error('Error fetching student attendance details:', error);
    return res.status(500).json({ 
      message: 'Server error',
      error: error.message
    });
  }
};

  
  // Get student information
  exports.getStudentById = async (req, res) => {
    try {
      const { id } = req.params;
      
      const student = await Student.findById(id).select('-password'); // Exclude password
      
      if (!student) {
        return res.status(404).json({ message: 'Student not found' });
      }
      
      return res.status(200).json(student);
    } catch (error) {
      console.error('Error fetching student information:', error);
      return res.status(500).json({ message: 'Server error' });
    }
  };

// Controller to send low attendance notifications
// Controller to send low attendance notifications
exports.sendLowAttendanceNotifications = async (req, res) => {
  try {
    const { attendanceSummary, threshold } = req.body;
    
    if (!attendanceSummary || !threshold) {
      return res.status(400).json({ message: 'Missing required data' });
    }

    // Filter students below threshold
    const lowAttendanceStudents = attendanceSummary.filter(record => {
      const percentage = (record.classesAttended / record.totalClasses) * 100;
      return percentage < threshold;
    });

    if (lowAttendanceStudents.length === 0) {
      return res.status(200).json({ 
        message: 'No students found below the threshold', 
        sentCount: 0 
      });
    }

    // Get subject name for the email
    const firstRecord = attendanceSummary[0];
    let subjectName = firstRecord.subject;

    // For each student, fetch their email and send notification
    let successCount = 0;
    let failedCount = 0;

    for (const student of lowAttendanceStudents) {
      try {
        // Fetch student details using _id
        const studentData = await Student.findOne({ _id: student.studentId });

        if (!studentData || !studentData.email) {
          console.log(`No email found for student ${student.studentName}`);
          failedCount++;
          continue;
        }

        const attendancePercentage = ((student.classesAttended / student.totalClasses) * 100).toFixed(2);
        const attendanceGap = threshold - attendancePercentage;
        const classesNeeded = calculateClassesNeeded(student.classesAttended, student.totalClasses, threshold);

        await sendLowAttendanceEmail(
          studentData.email,
          studentData.fullName,
          studentData.rollNumber,
          subjectName,
          attendancePercentage,
          threshold,
          attendanceGap,
          student.classesAttended,
          student.totalClasses,
          classesNeeded
        );

        successCount++;
      } catch (error) {
        console.error(`Error sending notification to ${student.studentName}:`, error);
        failedCount++;
      }
    }

    return res.status(200).json({
      message: 'Notifications processed',
      sentCount: successCount,
      failedCount: failedCount,
      totalProcessed: lowAttendanceStudents.length
    });

  } catch (error) {
    console.error('Error in sendLowAttendanceNotifications:', error);
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

  
  // Calculate how many consecutive classes a student needs to attend to reach the threshold
  function calculateClassesNeeded(present, total, threshold) {
    const currentPercentage = (present / total) * 100;
    
    if (currentPercentage >= threshold) return 0;
    
    let additionalClasses = 0;
    let newTotal = total;
    let newPresent = present;
    
    while ((newPresent / newTotal) * 100 < threshold) {
      additionalClasses++;
      newPresent++;
      newTotal++;
    }
    
    return additionalClasses;
  }
  
  // Function to send the low attendance email
  async function sendLowAttendanceEmail(
    email, 
    studentName, 
    rollNumber, 
    subject, 
    currentPercentage, 
    threshold, 
    gap, 
    present, 
    total,
    classesNeeded
  ) {
    // Format the email with HTML for better readability
    const emailSubject = `⚠️ IMPORTANT: Low Attendance Warning for ${subject}`;
    
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
        <div style="background-color: #f8d7da; padding: 15px; border-radius: 5px; margin-bottom: 20px; border-left: 5px solid #dc3545;">
          <h2 style="color: #721c24; margin-top: 0;">Low Attendance Alert</h2>
          <p style="margin-bottom: 0;">This is an important notification regarding your attendance in ${subject}.</p>
        </div>
        
        <p>Dear <strong>${studentName}</strong> (Roll No: ${rollNumber}),</p>
        
        <p>We are writing to inform you that your current attendance in <strong>${subject}</strong> has fallen below the acceptable threshold.</p>
        
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Your current attendance:</strong> ${currentPercentage}% (${present} out of ${total} classes)</p>
          <p style="margin: 5px 0;"><strong>Required attendance threshold:</strong> ${threshold}%</p>
          <p style="margin: 5px 0;"><strong>Gap to minimum requirement:</strong> ${gap.toFixed(2)}%</p>
          <p style="margin: 5px 0;"><strong>Classes you need to attend consecutively:</strong> ${classesNeeded}</p>
        </div>
        
        <p><strong>Important:</strong> As per institutional policy, students with attendance below 75% may be prevented from taking examinations or may be subject to other academic penalties.</p>
        
        <div style="margin: 20px 0;">
          <h3>Actions Required:</h3>
          <ol>
            <li>Ensure regular attendance in all upcoming classes</li>
            <li>Meet with your course instructor to discuss your situation</li>
            <li>If you have legitimate reasons for absences (medical or otherwise), please submit appropriate documentation to the administration office</li>
          </ol>
        </div>
        
        <p>Please take this notification seriously and take immediate steps to improve your attendance. If you have any questions or need assistance, please contact your course instructor or the academic office.</p>
        
        <div style="margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px;">
          <p style="margin: 5px 0;">Regards,</p>
          <p style="margin: 5px 0;"><strong>Academic Administration</strong></p>
          <p style="margin: 5px 0; color: #666; font-size: 0.9em;">This is an automated message. Please do not reply directly to this email.</p>
        </div>
      </div>
    `;
    
    try {
      await emailService.sendAttendanceEmail(
        email,
        emailSubject,
        emailHtml
      );
      return true;
    } catch (error) {
      console.error('Error sending attendance email:', error);
      throw error;
    }
  }