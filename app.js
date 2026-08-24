async function loadFirebaseConfig() {
  const hasRequiredConfig = config => [
    config.apiKey,
    config.authDomain,
    config.projectId,
    config.storageBucket,
    config.messagingSenderId,
    config.appId
  ].every(Boolean);

  try {
    const endpointResponse = await fetch('/api/firebase-config', { cache: 'no-store' });
    if (endpointResponse.ok) {
      const contentType = endpointResponse.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const payload = await endpointResponse.json();
        const config = payload.firebase || payload;
        if (hasRequiredConfig(config)) return config;
      }
    }
  } catch (error) {
    console.warn('Netlify Firebase configuration unavailable; trying .env:', error.message);
  }

  let response;
  try {
    response = await fetch('.env', { cache: 'no-store' });
  } catch (error) {
    throw new Error('Firebase configuration is unavailable from Netlify or .env');
  }
  if (!response.ok) {
    throw new Error('Firebase configuration is unavailable from Netlify or .env');
  }

  const env = {};
  (await response.text()).split(/\r?\n/).forEach(line => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  });

  const firebaseConfig = {
    apiKey: env.FIREBASE_API_KEY,
    authDomain: env.FIREBASE_AUTH_DOMAIN,
    projectId: env.FIREBASE_PROJECT_ID,
    storageBucket: env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID,
    appId: env.FIREBASE_APP_ID,
    measurementId: env.FIREBASE_MEASUREMENT_ID
  };

  if (hasRequiredConfig(firebaseConfig)) {
    return firebaseConfig;
  }

  throw new Error('Firebase configuration is incomplete in Netlify variables or .env');
}

function setupPortalNavigation() {
  const mainContent = document.getElementById('mainContent');
  const adminPortal = document.getElementById('adminPortal');
  const toggleAdminBtn = document.getElementById('toggleAdminBtn');
  const applyNowNavBtn = document.querySelector('.apply-now-nav-btn');

  if (mainContent && adminPortal && toggleAdminBtn && !toggleAdminBtn.dataset.portalNavigationReady) {
    toggleAdminBtn.dataset.portalNavigationReady = 'true';
    toggleAdminBtn.addEventListener('click', () => {
      mainContent.classList.add('hidden');
      adminPortal.classList.remove('hidden');
    });
  }

  if (mainContent && adminPortal && applyNowNavBtn && !applyNowNavBtn.dataset.portalNavigationReady) {
    applyNowNavBtn.dataset.portalNavigationReady = 'true';
    applyNowNavBtn.addEventListener('click', (e) => {
      e.preventDefault();
      adminPortal.classList.add('hidden');
      mainContent.classList.remove('hidden');
      document.getElementById('admission')?.scrollIntoView({ behavior: 'smooth' });
    });
  }
}

function setupParentInfoNavigation() {
  const parentInfoButton = document.querySelector('.next-step-btn[data-target-step="2"]');
  const reviewButton = document.querySelector('.next-step-btn[data-target-step="3"]');

  const showStep = stepNumber => {
    document.querySelectorAll('.form-step-pane').forEach((pane, index) => {
      pane.classList.toggle('active', index + 1 === stepNumber);
    });
    document.querySelectorAll('.progress-step').forEach((step, index) => {
      step.classList.toggle('active', index < stepNumber);
    });
  };

  if (parentInfoButton && !parentInfoButton.dataset.navigationReady) {
    parentInfoButton.dataset.navigationReady = 'true';
    parentInfoButton.addEventListener('click', () => {
      const requiredFields = [
        document.getElementById('childName'),
        document.getElementById('childDob'),
        document.getElementById('childGender'),
        document.getElementById('gradeSelection')
      ];

      if (requiredFields.some(field => !field || !field.value.trim())) {
        alert('Please fill out all required child details! 🎈');
        return;
      }

      showStep(2);
    });
  }

  if (reviewButton && !reviewButton.dataset.navigationReady) {
    reviewButton.dataset.navigationReady = 'true';
    reviewButton.addEventListener('click', () => {
      const parentName = document.getElementById('parentName');
      const parentPhone = document.getElementById('parentPhone');
      const parentEmail = document.getElementById('parentEmail');
      const parentAddress = document.getElementById('parentAddress');

      if ([parentName, parentPhone, parentEmail, parentAddress].some(field => !field || !field.value.trim())) {
        alert('Please fill out all parent or guardian info! 👨‍👩‍👧‍👦');
        return;
      }

      document.getElementById('revChildName').textContent = document.getElementById('childName').value;
      document.getElementById('revGrade').textContent = document.getElementById('gradeSelection').value;
      document.getElementById('revDob').textContent = document.getElementById('childDob').value;
      document.getElementById('revGender').textContent = document.getElementById('childGender').value;
      document.getElementById('revParentName').textContent = parentName.value.trim();
      document.getElementById('revPhone').textContent = parentPhone.value.trim();
      document.getElementById('revEmail').textContent = parentEmail.value.trim();
      showStep(3);
    });
  }
}

function setupAdminLoginGuard() {
  const adminLoginForm = document.getElementById('adminLoginForm');
  const authErrorMsg = document.getElementById('authErrorMsg');
  if (!adminLoginForm || adminLoginForm.dataset.loginGuardReady) return;

  adminLoginForm.dataset.loginGuardReady = 'true';
  adminLoginForm.addEventListener('submit', event => {
    if (window.firebase?.apps?.length) return;

    event.preventDefault();
    const startedAt = Date.now();
    const waitForFirebase = () => {
      if (window.firebase?.apps?.length) {
        adminLoginForm.requestSubmit();
        return;
      }

      if (window.firebaseStartupFailed || Date.now() - startedAt > 10000) {
        if (authErrorMsg) {
          authErrorMsg.textContent = 'Unable to connect to Firebase. Check the Firebase configuration.';
          authErrorMsg.classList.remove('hidden');
        }
        return;
      }

      setTimeout(waitForFirebase, 100);
    };

    waitForFirebase();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupPortalNavigation);
  document.addEventListener('DOMContentLoaded', setupParentInfoNavigation);
  document.addEventListener('DOMContentLoaded', setupAdminLoginGuard);
} else {
  setupPortalNavigation();
  setupParentInfoNavigation();
  setupAdminLoginGuard();
}

loadFirebaseConfig().then(firebaseConfig => {
  firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();

  const startApp = () => {
    // --- State ---
    let applications = [];
    let messages = [];
    let students = [];
    let activities = [];
    let unsubApps = null;
    let unsubMessages = null;
    let unsubStudents = null;
    let unsubActivities = null;

    function loadFirestoreData() {
      if (unsubApps) unsubApps();
      if (unsubMessages) unsubMessages();
      if (unsubStudents) unsubStudents();
      unsubApps = db.collection('applications').onSnapshot(snapshot => {
        applications = [];
        snapshot.forEach(doc => {
          applications.push({
            id: doc.id,
            ...doc.data()
          });
        });
        if (tabApplicationsBtn.classList.contains('active')) {
          renderAdminDashboard();
        }
      }, error => {
        console.error("Error listening to applications:", error);
      });

      unsubMessages = db.collection('messages').onSnapshot(snapshot => {
        messages = [];
        snapshot.forEach(doc => {
          messages.push({
            id: doc.id,
            ...doc.data()
          });
        });
        if (tabMessagesBtn.classList.contains('active')) {
          renderMessagesDashboard();
        }
      }, error => {
        console.error("Error listening to messages:", error);
      });

      unsubStudents = db.collection('students').onSnapshot(snapshot => {
        students = [];
        snapshot.forEach(doc => {
          students.push({
            id: doc.id,
            ...doc.data()
          });
        });
        if (typeof tabStudentsBtn !== 'undefined' && tabStudentsBtn && tabStudentsBtn.classList.contains('active')) {
          renderStudentsDashboard();
        }
      }, error => {
        console.error("Error listening to students:", error);
      });

    }

    // --- DOM Elements ---
    // Navigation & Sections
    const mainContent = document.getElementById('mainContent');
    const adminPortal = document.getElementById('adminPortal');
    const toggleAdminBtn = document.getElementById('toggleAdminBtn');
    const closeAdminBtn = document.getElementById('closeAdminBtn');
    const navLinks = document.querySelectorAll('.nav-link');

    // Form Wizard
    const admissionForm = document.getElementById('admissionForm');
    const formSuccessCard = document.getElementById('formSuccessMessage');
    const submittedTicketId = document.getElementById('submittedTicketId');
    const resetFormBtn = document.getElementById('resetFormBtn');
    const stepPanes = document.querySelectorAll('.form-step-pane');
    const progressSteps = document.querySelectorAll('.progress-step');

    // Form Review Fields
    const revChildName = document.getElementById('revChildName');
    const revGrade = document.getElementById('revGrade');
    const revDob = document.getElementById('revDob');
    const revGender = document.getElementById('revGender');
    const revParentName = document.getElementById('revParentName');
    const revPhone = document.getElementById('revPhone');
    const revEmail = document.getElementById('revEmail');

    // Admin Portal Dashboard - Tabs
    const tabApplicationsBtn = document.getElementById('tabApplicationsBtn');
    const tabMessagesBtn = document.getElementById('tabMessagesBtn');
    const tabStudentsBtn = document.getElementById('tabStudentsBtn');
    const tabActivitiesBtn = document.getElementById('tabActivitiesBtn');
    const admissionsTabContent = document.getElementById('admissionsTabContent');
    const messagesTabContent = document.getElementById('messagesTabContent');
    const studentsTabContent = document.getElementById('studentsTabContent');
    const activitiesTabContent = document.getElementById('activitiesTabContent');

    // Admin Portal Dashboard - Admissions
    const statTotalVal = document.getElementById('statTotalVal');
    const statPendingVal = document.getElementById('statPendingVal');
    const statApprovedVal = document.getElementById('statApprovedVal');
    const statRejectedVal = document.getElementById('statRejectedVal');
    const adminSearchInput = document.getElementById('adminSearchInput');
    const filterGradeSelect = document.getElementById('filterGradeSelect');
    const filterStatusSelect = document.getElementById('filterStatusSelect');
    const clearFiltersBtn = document.getElementById('clearFiltersBtn');
    const applicantsTableBody = document.getElementById('applicantsTableBody');
    const clearAllDataBtn = document.getElementById('clearAllDataBtn');

    // Admin Portal Dashboard - Messages
    const msgStatTotalVal = document.getElementById('msgStatTotalVal');
    const adminMsgSearchInput = document.getElementById('adminMsgSearchInput');
    const clearMsgFiltersBtn = document.getElementById('clearMsgFiltersBtn');
    const messagesTableBody = document.getElementById('messagesTableBody');

    // Admin Portal Dashboard - Students
    const studentForm = document.getElementById('studentForm');
    const customStudentId = document.getElementById('customStudentId');
    const studentName = document.getElementById('studentName');
    const studentClass = document.getElementById('studentClass');
    const studentFee = document.getElementById('studentFee');
    const studentPhotoUpload = document.getElementById('studentPhotoUpload');
    const studentPhotoDataUrl = document.getElementById('studentPhotoDataUrl');
    const studentPhotoPreviewContainer = document.getElementById('studentPhotoPreviewContainer');
    const studentPhotoPreview = document.getElementById('studentPhotoPreview');
    const studentSearchInput = document.getElementById('studentSearchInput');
    const studentClassFilter = document.getElementById('studentClassFilter');
    const clearStudentFiltersBtn = document.getElementById('clearStudentFiltersBtn');
    const studentListTableBody = document.getElementById('studentListTableBody');

    // Admin Portal Dashboard - Activities
    const activityForm = document.getElementById('activityForm');
    const activityTitle = document.getElementById('activityTitle');
    const activityDescription = document.getElementById('activityDescription');
    const activityPhotoUpload = document.getElementById('activityPhotoUpload');
    const activityPhotoDataUrl = document.getElementById('activityPhotoDataUrl');
    const activityPhotoPreviewContainer = document.getElementById('activityPhotoPreviewContainer');
    const activityPhotoPreview = document.getElementById('activityPhotoPreview');
    const activityListTableBody = document.getElementById('activityListTableBody');
    const activityCarouselTrack = document.getElementById('activityCarouselTrack');
    const activityCarouselDots = document.getElementById('activityCarouselDots');

    function loadPublicActivities() {
      if (unsubActivities) unsubActivities();

      unsubActivities = db.collection('activities').onSnapshot(snapshot => {
        activities = [];
        snapshot.forEach(doc => {
          activities.push({ id: doc.id, ...doc.data() });
        });
        activities.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));
        if (tabActivitiesBtn && tabActivitiesBtn.classList.contains('active')) {
          renderActivitiesDashboard();
        }
        renderFrontPageActivitiesCarousel();
      }, error => {
        console.error("Error listening to activities:", error);
        activityCarouselTrack.innerHTML = `
        <div style="text-align: center; width: 100%; color: var(--text-color); font-weight: 500; padding: 40px;">
          Activities are temporarily unavailable. Please check back soon.
        </div>
      `;
      });
    }

    loadPublicActivities();

    // Student Edit Modal
    const studentEditModal = document.getElementById('studentEditModal');
    const editStudentForm = document.getElementById('editStudentForm');
    const editStudentId = document.getElementById('editStudentId');
    const editStudentName = document.getElementById('editStudentName');
    const editStudentClass = document.getElementById('editStudentClass');
    const editStudentFee = document.getElementById('editStudentFee');
    const editStudentPaidDisplay = document.getElementById('editStudentPaidDisplay');
    const editStudentBalanceDisplay = document.getElementById('editStudentBalanceDisplay');
    const editStudentPayAmount = document.getElementById('editStudentPayAmount');
    const editStudentPhotoUpload = document.getElementById('editStudentPhotoUpload');
    const editStudentPhotoDataUrl = document.getElementById('editStudentPhotoDataUrl');
    const editStudentPhotoPreviewContainer = document.getElementById('editStudentPhotoPreviewContainer');
    const editStudentPhotoPreview = document.getElementById('editStudentPhotoPreview');
    const closeStudentEditModalBtn = document.getElementById('closeStudentEditModalBtn');
    const closeStudentEditModalFooterBtn = document.getElementById('closeStudentEditModalFooterBtn');

    // Modal
    const detailsModal = document.getElementById('detailsModal');
    const modalDetailsBody = document.getElementById('modalDetailsBody');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const closeModalFooterBtn = document.getElementById('closeModalFooterBtn');
    const logoutAdminBtn = document.getElementById('logoutAdminBtn');
    const adminLoginSubmitBtn = document.getElementById('adminLoginSubmitBtn');

    // --- Active Nav Links & Scroll ---
    navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        // If we are in admin portal, switch back to home view
        if (!adminPortal.classList.contains('hidden')) {
          adminPortal.classList.add('hidden');
          mainContent.classList.remove('hidden');
        }
        navLinks.forEach(n => n.classList.remove('active'));
        link.classList.add('active');
      });
    });

    // --- Admin View Toggle & Authentication ---
    const adminAuthContainer = document.getElementById('adminAuthContainer');
    const adminDashboardContainer = document.getElementById('adminDashboardContainer');
    const adminLoginForm = document.getElementById('adminLoginForm');
    const authErrorMsg = document.getElementById('authErrorMsg');
    const exitAuthBtn = document.getElementById('exitAuthBtn');

    // Firebase Auth State Listener
    auth.onAuthStateChanged(user => {
      if (user) {
        adminAuthContainer.classList.add('hidden');
        adminDashboardContainer.classList.remove('hidden');
        switchTab('applications');
        loadFirestoreData();
      } else {
        adminAuthContainer.classList.remove('hidden');
        adminDashboardContainer.classList.add('hidden');
        authErrorMsg.classList.add('hidden');
        adminLoginForm.reset();
        if (unsubApps) { unsubApps(); unsubApps = null; }
        if (unsubMessages) { unsubMessages(); unsubMessages = null; }
        if (unsubStudents) { unsubStudents(); unsubStudents = null; }
      }
    });

    const footerAdminLoginLink = document.getElementById('footerAdminLoginLink');
    if (footerAdminLoginLink) {
      footerAdminLoginLink.addEventListener('click', (e) => {
        e.preventDefault();
        toggleAdminBtn.click();
        adminPortal.scrollIntoView({ behavior: 'smooth' });
      });
    }

    adminLoginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = document.getElementById('adminEmail').value.trim();
      const password = document.getElementById('adminPassword').value;

      // Show loading state
      adminLoginSubmitBtn.disabled = true;
      adminLoginSubmitBtn.querySelector('span').textContent = 'Authenticating... ⏳';
      authErrorMsg.classList.add('hidden');

      auth.setPersistence(firebase.auth.Auth.Persistence.SESSION)
        .then(() => {
          return auth.signInWithEmailAndPassword(email, password);
        })
        .catch(error => {
          if (error.code === 'auth/invalid-credential' ||
            error.code === 'auth/user-not-found' ||
            error.code === 'auth/wrong-password' ||
            error.code === 'auth/invalid-email') {
            authErrorMsg.textContent = 'Incorrect username or password 🚫';
          } else {
            authErrorMsg.textContent = error.message + ' 🚫';
          }
          authErrorMsg.classList.remove('hidden');
        })
        .finally(() => {
          adminLoginSubmitBtn.disabled = false;
          adminLoginSubmitBtn.querySelector('span').textContent = 'Enter Dashboard 🚀';
        });
    });

    if (logoutAdminBtn) {
      logoutAdminBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to log out? 🔒')) {
          auth.signOut();
        }
      });
    }

    exitAuthBtn.addEventListener('click', () => {
      adminPortal.classList.add('hidden');
      mainContent.classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    closeAdminBtn.addEventListener('click', () => {
      adminPortal.classList.add('hidden');
      mainContent.classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // --- Admin Tabs switching ---
    function switchTab(tab) {
      tabApplicationsBtn.classList.remove('active');
      tabMessagesBtn.classList.remove('active');
      tabStudentsBtn.classList.remove('active');
      if (tabActivitiesBtn) tabActivitiesBtn.classList.remove('active');

      admissionsTabContent.classList.add('hidden');
      messagesTabContent.classList.add('hidden');
      studentsTabContent.classList.add('hidden');
      if (activitiesTabContent) activitiesTabContent.classList.add('hidden');

      if (tab === 'applications') {
        tabApplicationsBtn.classList.add('active');
        admissionsTabContent.classList.remove('hidden');
        renderAdminDashboard();
      } else if (tab === 'messages') {
        tabMessagesBtn.classList.add('active');
        messagesTabContent.classList.remove('hidden');
        renderMessagesDashboard();
      } else if (tab === 'students') {
        tabStudentsBtn.classList.add('active');
        studentsTabContent.classList.remove('hidden');
        renderStudentsDashboard();
      } else if (tab === 'activities' && tabActivitiesBtn) {
        tabActivitiesBtn.classList.add('active');
        activitiesTabContent.classList.remove('hidden');
        renderActivitiesDashboard();
      }
    }

    tabApplicationsBtn.addEventListener('click', () => switchTab('applications'));
    tabMessagesBtn.addEventListener('click', () => switchTab('messages'));
    tabStudentsBtn.addEventListener('click', () => switchTab('students'));
    if (tabActivitiesBtn) tabActivitiesBtn.addEventListener('click', () => switchTab('activities'));

    // --- Contact Form Handling ---
    const schoolContactForm = document.getElementById('schoolContactForm');
    const contactSuccessMessage = document.getElementById('contactSuccessMessage');

    if (schoolContactForm) {
      schoolContactForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const newMsg = {
          name: document.getElementById('contactName').value.trim(),
          email: document.getElementById('contactEmail').value.trim(),
          message: document.getElementById('contactMessage').value.trim(),
          dateAdded: new Date().toLocaleDateString()
        };

        const customId = 'MSG-' + (1000 + Math.floor(Math.random() * 9000));

        db.collection('messages').doc(customId).set(newMsg)
          .then(() => {
            schoolContactForm.classList.add('hidden');
            contactSuccessMessage.classList.remove('hidden');
          })
          .catch(error => {
            alert("Error submitting message: " + error.message);
          });
      });
    }

    // --- Form Wizard Controls ---
    document.querySelectorAll('.next-step-btn:not([data-navigation-ready])').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetStep = parseInt(btn.getAttribute('data-target-step'));

        // Basic validation for Step 1
        if (targetStep === 2) {
          const childName = document.getElementById('childName').value.trim();
          const childDob = document.getElementById('childDob').value;
          const childGender = document.getElementById('childGender').value;
          const gradeSelection = document.getElementById('gradeSelection').value;

          if (!childName || !childDob || !childGender || !gradeSelection) {
            alert('Please fill out all required child details! 🎈');
            return;
          }
        }

        // Basic validation for Step 2
        if (targetStep === 3) {
          const parentName = document.getElementById('parentName').value.trim();
          const parentPhone = document.getElementById('parentPhone').value.trim();
          const parentEmail = document.getElementById('parentEmail').value.trim();
          const parentAddress = document.getElementById('parentAddress').value.trim();

          if (!parentName || !parentPhone || !parentEmail || !parentAddress) {
            alert('Please fill out all parent or guardian info! 👨‍👩‍👧‍👦');
            return;
          }

          // Populate step 3 preview
          revChildName.textContent = document.getElementById('childName').value;
          revGrade.textContent = document.getElementById('gradeSelection').value;
          revDob.textContent = document.getElementById('childDob').value;
          revGender.textContent = document.getElementById('childGender').value;
          revParentName.textContent = parentName;
          revPhone.textContent = parentPhone;
          revEmail.textContent = parentEmail;
        }

        showStep(targetStep);
      });
    });

    document.querySelectorAll('.prev-step-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetStep = parseInt(btn.getAttribute('data-target-step'));
        showStep(targetStep);
      });
    });

    function showStep(stepNum) {
      stepPanes.forEach((pane, idx) => {
        if (idx + 1 === stepNum) {
          pane.classList.add('active');
        } else {
          pane.classList.remove('active');
        }
      });

      progressSteps.forEach((step, idx) => {
        if (idx + 1 <= stepNum) {
          step.classList.add('active');
        } else {
          step.classList.remove('active');
        }
      });
    }

    // --- Form Submit ---
    admissionForm.addEventListener('submit', (e) => {
      e.preventDefault();

      const customId = 'APP-' + (1000 + Math.floor(Math.random() * 9000));
      const newApp = {
        childName: document.getElementById('childName').value.trim(),
        childDob: document.getElementById('childDob').value,
        childGender: document.getElementById('childGender').value,
        grade: document.getElementById('gradeSelection').value,
        parentName: document.getElementById('parentName').value.trim(),
        parentPhone: document.getElementById('parentPhone').value.trim(),
        parentEmail: document.getElementById('parentEmail').value.trim(),
        parentAddress: document.getElementById('parentAddress').value.trim(),
        specialNotes: document.getElementById('specialNotes').value.trim(),
        status: 'Pending',
        dateAdded: new Date().toLocaleDateString()
      };

      db.collection('applications').doc(customId).set(newApp)
        .then(() => {
          submittedTicketId.textContent = customId;
          admissionForm.classList.add('hidden');
          formSuccessCard.classList.remove('hidden');
        })
        .catch(error => {
          alert("Error submitting application: " + error.message);
        });
    });

    resetFormBtn.addEventListener('click', () => {
      admissionForm.reset();
      admissionForm.classList.remove('hidden');
      formSuccessCard.classList.add('hidden');
      showStep(1);
    });

    // --- Admin Dashboard Rendering & Stats ---
    function renderAdminDashboard() {
      // Calc stats
      const total = applications.length;
      const pending = applications.filter(a => a.status === 'Pending').length;
      const approved = applications.filter(a => a.status === 'Approved').length;
      const rejected = applications.filter(a => a.status === 'Rejected').length;

      statTotalVal.textContent = total;
      statPendingVal.textContent = pending;
      statApprovedVal.textContent = approved;
      statRejectedVal.textContent = rejected;

      // Filter list
      const searchQuery = adminSearchInput.value.toLowerCase();
      const gradeFilter = filterGradeSelect.value;
      const statusFilter = filterStatusSelect.value;

      const filtered = applications.filter(app => {
        const matchSearch = app.childName.toLowerCase().includes(searchQuery) ||
          app.parentName.toLowerCase().includes(searchQuery);
        const matchGrade = gradeFilter === 'ALL' || app.grade === gradeFilter;
        const matchStatus = statusFilter === 'ALL' || app.status === statusFilter;
        return matchSearch && matchGrade && matchStatus;
      });

      // Populate Table
      if (filtered.length === 0) {
        applicantsTableBody.innerHTML = `
        <tr>
          <td colspan="7" class="empty-table-state">
            <span class="empty-icon">📭</span>
            <p>No matching applications found!</p>
          </td>
        </tr>
      `;
      } else {
        applicantsTableBody.innerHTML = filtered.map(app => `
        <tr>
          <td><strong>${app.id}</strong></td>
          <td>
            <span class="applicant-card-name">${app.childName}</span>
            <span class="applicant-card-sub">${app.childGender}, DOB: ${app.childDob}</span>
          </td>
          <td><span class="grade-pill">${app.grade}</span></td>
          <td>
            <span class="applicant-card-name">${app.parentName}</span>
            <span class="applicant-card-sub">📞 ${app.parentPhone}</span>
          </td>
          <td>${app.dateAdded}</td>
          <td>
            <span class="status-badge ${app.status.toLowerCase()}">${app.status}</span>
          </td>
          <td class="table-actions-cell">
            <button class="action-btn view" data-id="${app.id}" title="View Details">👁️</button>
            <button class="action-btn approve" data-id="${app.id}" title="Approve">✓</button>
            <button class="action-btn reject" data-id="${app.id}" title="Reject">✗</button>
            <button class="action-btn delete" data-id="${app.id}" title="Delete">🗑️</button>
          </td>
        </tr>
      `).join('');

        // Wire action events
        document.querySelectorAll('.action-btn.view').forEach(btn => {
          btn.addEventListener('click', () => openAppDetails(btn.getAttribute('data-id')));
        });
        document.querySelectorAll('.action-btn.approve').forEach(btn => {
          btn.addEventListener('click', () => updateAppStatus(btn.getAttribute('data-id'), 'Approved'));
        });
        document.querySelectorAll('.action-btn.reject').forEach(btn => {
          btn.addEventListener('click', () => updateAppStatus(btn.getAttribute('data-id'), 'Rejected'));
        });
        document.querySelectorAll('.action-btn.delete').forEach(btn => {
          btn.addEventListener('click', () => deleteApp(btn.getAttribute('data-id')));
        });
      }
    }

    // --- Actions ---
    function updateAppStatus(id, newStatus) {
      db.collection('applications').doc(id).update({ status: newStatus })
        .catch(error => {
          alert("Error updating application: " + error.message);
        });
    }

    function deleteApp(id) {
      if (confirm('Are you sure you want to delete this applicant? 🗑️')) {
        db.collection('applications').doc(id).delete()
          .catch(error => {
            alert("Error deleting application: " + error.message);
          });
      }
    }

    function openAppDetails(id) {
      const app = applications.find(a => a.id === id);
      if (!app) return;

      modalDetailsBody.innerHTML = `
      <div class="print-only-header" style="text-align: center; border-bottom: 3px double #000; padding-bottom: 15px; margin-bottom: 25px;">
        <h2 style="margin: 0; font-size: 1.6rem; font-weight: 800; text-transform: uppercase; color: #000; letter-spacing: 1px;">Vahinija Global Play School & Grades 1-7</h2>
        <p style="margin: 5px 0 0 0; font-size: 0.95rem; font-weight: 600; color: #475569; text-transform: uppercase;">Official Admission Application Record</p>
      </div>

      <div class="detail-row">
        <div class="detail-label">Application ID:</div>
        <div class="detail-val"><strong>${app.id}</strong></div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Child Name:</div>
        <div class="detail-val">${app.childName}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Date of Birth:</div>
        <div class="detail-val">${app.childDob}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Gender:</div>
        <div class="detail-val">${app.childGender}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Class Applied:</div>
        <div class="detail-val">${app.grade}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Parent Name:</div>
        <div class="detail-val">${app.parentName}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Parent Phone:</div>
        <div class="detail-val">${app.parentPhone}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Parent Email:</div>
        <div class="detail-val">${app.parentEmail}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Address:</div>
        <div class="detail-val">${app.parentAddress}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Special Notes:</div>
        <div class="detail-val">${app.specialNotes || 'None'}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Status:</div>
        <div class="detail-val"><span class="status-badge ${app.status.toLowerCase()}">${app.status}</span></div>
      </div>

      <div class="print-only-footer" style="margin-top: 50px;">
        <div style="display: flex; justify-content: space-between; margin-top: 60px;">
          <div style="text-align: center; width: 220px; border-top: 1.5px solid #000; padding-top: 8px; font-weight: bold; font-size: 10pt; color: #000;">Parent/Guardian Signature</div>
          <div style="text-align: center; width: 220px; border-top: 1.5px solid #000; padding-top: 8px; font-weight: bold; font-size: 10pt; color: #000;">Authorized Signatory</div>
        </div>
      </div>
    `;

      detailsModal.classList.remove('hidden');
    }

    // --- Modal Events ---
    function closeModal() {
      detailsModal.classList.add('hidden');
    }
    closeModalBtn.addEventListener('click', closeModal);
    closeModalFooterBtn.addEventListener('click', closeModal);

    // --- Dashboard Filters Events ---
    adminSearchInput.addEventListener('input', renderAdminDashboard);
    filterGradeSelect.addEventListener('change', renderAdminDashboard);
    filterStatusSelect.addEventListener('change', renderAdminDashboard);

    clearFiltersBtn.addEventListener('click', () => {
      adminSearchInput.value = '';
      filterGradeSelect.value = 'ALL';
      filterStatusSelect.value = 'ALL';
      renderAdminDashboard();
    });

    // --- Messages Dashboard Rendering & Actions ---
    function renderMessagesDashboard() {
      // Calc stats
      const total = messages.length;
      msgStatTotalVal.textContent = total;

      // Filter list
      const searchQuery = adminMsgSearchInput.value.toLowerCase();

      const filtered = messages.filter(msg => {
        return msg.name.toLowerCase().includes(searchQuery) ||
          msg.email.toLowerCase().includes(searchQuery) ||
          msg.message.toLowerCase().includes(searchQuery);
      });

      // Populate Table
      if (filtered.length === 0) {
        messagesTableBody.innerHTML = `
        <tr>
          <td colspan="5" class="empty-table-state">
            <span class="empty-icon">📭</span>
            <p>No matching messages found!</p>
          </td>
        </tr>
      `;
      } else {
        messagesTableBody.innerHTML = filtered.map(msg => {
          const snippet = msg.message.length > 60 ? msg.message.substring(0, 60) + '...' : msg.message;
          return `
          <tr>
            <td><strong>${msg.id}</strong></td>
            <td>
              <span class="applicant-card-name">${msg.name}</span>
              <span class="applicant-card-sub">${msg.email}</span>
            </td>
            <td>${snippet}</td>
            <td>${msg.dateAdded}</td>
            <td class="table-actions-cell">
              <button class="action-btn view view-msg" data-id="${msg.id}" title="View Message">👁️</button>
              <button class="action-btn delete delete-msg" data-id="${msg.id}" title="Delete Message">🗑️</button>
            </td>
          </tr>
        `;
        }).join('');

        // Wire action events
        document.querySelectorAll('.action-btn.view-msg').forEach(btn => {
          btn.addEventListener('click', () => openMsgDetails(btn.getAttribute('data-id')));
        });
        document.querySelectorAll('.action-btn.delete-msg').forEach(btn => {
          btn.addEventListener('click', () => deleteMsg(btn.getAttribute('data-id')));
        });
      }
    }

    function deleteMsg(id) {
      if (confirm('Are you sure you want to delete this message? 🗑️')) {
        db.collection('messages').doc(id).delete()
          .catch(error => {
            alert("Error deleting message: " + error.message);
          });
      }
    }

    function openMsgDetails(id) {
      const msg = messages.find(m => m.id === id);
      if (!msg) return;

      modalDetailsBody.innerHTML = `
      <div class="detail-row">
        <div class="detail-label">Message ID:</div>
        <div class="detail-val"><strong>${msg.id}</strong></div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Sender Name:</div>
        <div class="detail-val">${msg.name}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Sender Email:</div>
        <div class="detail-val">${msg.email}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Date Received:</div>
        <div class="detail-val">${msg.dateAdded}</div>
      </div>
      <div class="detail-row" style="grid-template-columns: 1fr; margin-top: 15px;">
        <div class="detail-label" style="margin-bottom: 8px;">Message Content:</div>
        <div class="detail-val" style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 12px; white-space: pre-wrap; line-height: 1.5;">${msg.message}</div>
      </div>
    `;

      detailsModal.classList.remove('hidden');
    }

    // --- Messages Filter Events ---
    adminMsgSearchInput.addEventListener('input', renderMessagesDashboard);
    clearMsgFiltersBtn.addEventListener('click', () => {
      adminMsgSearchInput.value = '';
      renderMessagesDashboard();
    });



    // --- Clear All Data ---
    // --- Clear All Data ---
    clearAllDataBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to clear all admission applications and messages? 🗑️ This action cannot be undone.')) {
        const batch = db.batch();

        const appPromise = db.collection('applications').get().then(snapshot => {
          snapshot.forEach(doc => {
            batch.delete(doc.ref);
          });
        });

        const msgPromise = db.collection('messages').get().then(snapshot => {
          snapshot.forEach(doc => {
            batch.delete(doc.ref);
          });
        });

        Promise.all([appPromise, msgPromise]).then(() => {
          batch.commit().then(() => {
            alert('All admission applications and messages have been cleared! 🧹');
          });
        }).catch(error => {
          alert("Error clearing data: " + error.message);
        });
      }
    });


    // --- Photo File Reader (Image to Base64) ---
    function handleImageUpload(inputEl, hiddenInputEl, previewEl, previewContainerEl, maxSizeKb = 800) {
      inputEl.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > maxSizeKb * 1024) {
          alert(`Image is too large! Please choose an image smaller than ${maxSizeKb}KB. 📸`);
          inputEl.value = '';
          return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
          const dataUrl = event.target.result;
          hiddenInputEl.value = dataUrl;
          if (previewEl) previewEl.src = dataUrl;
          if (previewContainerEl) previewContainerEl.style.display = 'flex';
        };
        reader.readAsDataURL(file);
      });
    }

    if (studentPhotoUpload && studentPhotoDataUrl && studentPhotoPreview && studentPhotoPreviewContainer) {
      handleImageUpload(studentPhotoUpload, studentPhotoDataUrl, studentPhotoPreview, studentPhotoPreviewContainer);
    }

    if (editStudentPhotoUpload && editStudentPhotoDataUrl && editStudentPhotoPreview && editStudentPhotoPreviewContainer) {
      handleImageUpload(editStudentPhotoUpload, editStudentPhotoDataUrl, editStudentPhotoPreview, editStudentPhotoPreviewContainer);
    }

    if (activityPhotoUpload && activityPhotoDataUrl && activityPhotoPreview && activityPhotoPreviewContainer) {
      handleImageUpload(activityPhotoUpload, activityPhotoDataUrl, activityPhotoPreview, activityPhotoPreviewContainer, 1536);
    }

    // --- Add Student Submit Handler ---
    if (studentForm) {
      studentForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const defaultAvatar = 'https://i.ibb.co/CsP3c9Nh/school.png';
        const annualFee = Number(studentFee.value) || 0;

        const newStudent = {
          studentName: studentName.value.trim(),
          studentClass: studentClass.value,
          studentFee: annualFee,
          paidFee: 0,
          balanceFee: annualFee,
          photoUrl: studentPhotoDataUrl.value || defaultAvatar,
          dateRegistered: new Date().toLocaleDateString()
        };

        const customId = customStudentId.value.trim();
        if (!customId) {
          alert("Please enter a valid Student ID! ⚠️");
          return;
        }

        // Check for uniqueness in DB
        db.collection('students').doc(customId).get()
          .then(doc => {
            if (doc.exists) {
              alert(`A student with ID "${customId}" already exists! 🚫 Please choose a unique ID.`);
              return;
            }

            db.collection('students').doc(customId).set(newStudent)
              .then(() => {
                studentForm.reset();
                if (studentPhotoPreviewContainer) {
                  studentPhotoPreviewContainer.style.display = 'none';
                }
                studentPhotoDataUrl.value = '';
              })
              .catch(error => {
                alert("Error adding student: " + error.message);
              });
          })
          .catch(error => {
            alert("Error verifying student ID: " + error.message);
          });
      });
    }

    // --- Render Students Dashboard (List, Search & Filter) ---
    function renderStudentsDashboard() {
      if (!studentListTableBody) return;

      const searchQuery = studentSearchInput.value.toLowerCase().trim();
      const classFilter = studentClassFilter.value;

      const filtered = students.filter(s => {
        const matchSearch = s.studentName.toLowerCase().includes(searchQuery);
        const matchClass = classFilter === 'ALL' || s.studentClass === classFilter;
        return matchSearch && matchClass;
      });

      if (filtered.length === 0) {
        studentListTableBody.innerHTML = `
        <tr>
          <td colspan="9" class="empty-table-state">
            <span class="empty-icon">🎒</span>
            <p>No matching student records found!</p>
          </td>
        </tr>
      `;
      } else {
        const sortedStudents = [...filtered].sort((a, b) => a.studentName.localeCompare(b.studentName));

        studentListTableBody.innerHTML = sortedStudents.map(s => {
          const annualFee = Number(s.studentFee) || 0;
          const paidFee = Number(s.paidFee) || 0;
          const balanceFee = (typeof s.balanceFee !== 'undefined') ? Number(s.balanceFee) : (annualFee - paidFee);

          return `
          <tr>
            <td><strong>${s.id}</strong></td>
            <td style="text-align: center;">
              <img src="${s.photoUrl || 'https://i.ibb.co/CsP3c9Nh/school.png'}" class="student-avatar" alt="${s.studentName}">
            </td>
            <td><strong>${s.studentName}</strong></td>
            <td><span class="grade-pill">${s.studentClass}</span></td>
            <td>₹${annualFee}</td>
            <td style="color: #4ade80; font-weight: 600;">₹${paidFee}</td>
            <td style="color: #fbbf24; font-weight: 600;">₹${balanceFee}</td>
            <td><span class="status-badge approved">Enrolled</span></td>
            <td class="table-actions-cell">
              <button class="action-btn view-student-btn" data-id="${s.id}" title="View Student">👁️</button>
              <button class="action-btn edit-student-btn" data-id="${s.id}" title="Edit Student">✏️</button>
              <button class="action-btn delete-student-btn" data-id="${s.id}" title="Delete Student">🗑️</button>
            </td>
          </tr>
        `;
        }).join('');

        // Wire action buttons
        document.querySelectorAll('.view-student-btn').forEach(btn => {
          btn.addEventListener('click', () => openStudentDetails(btn.getAttribute('data-id')));
        });
        document.querySelectorAll('.edit-student-btn').forEach(btn => {
          btn.addEventListener('click', () => openEditStudentModal(btn.getAttribute('data-id')));
        });
        document.querySelectorAll('.delete-student-btn').forEach(btn => {
          btn.addEventListener('click', () => deleteStudent(btn.getAttribute('data-id')));
        });
      }
    }

    if (studentSearchInput) {
      studentSearchInput.addEventListener('input', renderStudentsDashboard);
    }
    if (studentClassFilter) {
      studentClassFilter.addEventListener('change', renderStudentsDashboard);
    }
    if (clearStudentFiltersBtn) {
      clearStudentFiltersBtn.addEventListener('click', () => {
        studentSearchInput.value = '';
        studentClassFilter.value = 'ALL';
        renderStudentsDashboard();
      });
    }

    // --- View Student Details Method ---
    function openStudentDetails(id) {
      const s = students.find(item => item.id === id);
      if (!s) return;

      const annualFee = Number(s.studentFee) || 0;
      const paid = Number(s.paidFee) || 0;
      const balance = (typeof s.balanceFee !== 'undefined') ? Number(s.balanceFee) : (annualFee - paid);

      modalDetailsBody.innerHTML = `
      <div class="print-only-header" style="text-align: center; border-bottom: 3px double #000; padding-bottom: 15px; margin-bottom: 25px;">
        <h2 style="margin: 0; font-size: 1.6rem; font-weight: 800; text-transform: uppercase; color: #000; letter-spacing: 1px;">Vahinija Global Play School & Grades 1-7</h2>
        <p style="margin: 5px 0 0 0; font-size: 0.95rem; font-weight: 600; color: #475569; text-transform: uppercase;">Official Student Enrollment Record</p>
      </div>

      <div style="display: flex; flex-direction: column; align-items: center; margin-bottom: 20px; border-bottom: 1px dashed rgba(255,255,255,0.1); padding-bottom: 20px;">
        <img src="${s.photoUrl || 'https://i.ibb.co/CsP3c9Nh/school.png'}" style="width: 120px; height: 120px; border-radius: 50%; object-fit: cover; border: 4px solid var(--primary-color); box-shadow: 0 8px 24px rgba(0,0,0,0.3); margin-bottom: 10px;">
        <h3 style="margin: 5px 0; color: #fff; font-size: 1.5rem;">${s.studentName}</h3>
        <span class="grade-pill" style="font-size: 0.9rem; padding: 6px 15px;">${s.studentClass}</span>
      </div>
      <div class="detail-row">
        <div class="detail-label">Student ID:</div>
        <div class="detail-val"><strong>${s.id}</strong></div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Registration Date:</div>
        <div class="detail-val">${s.dateRegistered || 'N/A'}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Annual Fee:</div>
        <div class="detail-val" style="font-weight: 600;">₹${annualFee}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Total Paid:</div>
        <div class="detail-val" style="color: #4ade80; font-weight: 600;">₹${paid}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Remaining Balance:</div>
        <div class="detail-val" style="color: #fbbf24; font-weight: 600;">₹${balance}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Status:</div>
        <div class="detail-val"><span class="status-badge approved">Enrolled</span></div>
      </div>

      <div class="print-only-footer" style="margin-top: 50px;">
        <div style="display: flex; justify-content: space-between; margin-top: 60px;">
          <div style="text-align: center; width: 220px; border-top: 1.5px solid #000; padding-top: 8px; font-weight: bold; font-size: 10pt; color: #000;">Parent/Guardian Signature</div>
          <div style="text-align: center; width: 220px; border-top: 1.5px solid #000; padding-top: 8px; font-weight: bold; font-size: 10pt; color: #000;">Principal / Authority</div>
        </div>
      </div>
    `;

      detailsModal.classList.remove('hidden');
    }

    // --- Edit & Delete Student Methods ---
    function openEditStudentModal(id) {
      const s = students.find(item => item.id === id);
      if (!s) return;

      const annualFee = Number(s.studentFee) || 0;
      const paid = Number(s.paidFee) || 0;
      const balance = (typeof s.balanceFee !== 'undefined') ? Number(s.balanceFee) : (annualFee - paid);

      editStudentId.value = s.id;
      editStudentName.value = s.studentName;
      editStudentClass.value = s.studentClass;
      editStudentFee.value = annualFee;

      // Set read-only displays
      editStudentPaidDisplay.textContent = '₹' + paid;
      editStudentBalanceDisplay.textContent = '₹' + balance;
      editStudentPayAmount.value = ''; // Reset input field

      editStudentPhotoDataUrl.value = s.photoUrl || '';
      editStudentPhotoPreview.src = s.photoUrl || 'https://i.ibb.co/CsP3c9Nh/school.png';
      editStudentPhotoPreviewContainer.style.display = 'flex';

      studentEditModal.classList.remove('hidden');
    }

    function closeStudentEditModal() {
      studentEditModal.classList.add('hidden');
      editStudentForm.reset();
    }

    if (closeStudentEditModalBtn) {
      closeStudentEditModalBtn.addEventListener('click', closeStudentEditModal);
    }
    if (closeStudentEditModalFooterBtn) {
      closeStudentEditModalFooterBtn.addEventListener('click', closeStudentEditModal);
    }

    if (editStudentForm) {
      editStudentForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const id = editStudentId.value;
        const s = students.find(item => item.id === id);
        if (!s) return;

        const updatedFee = Number(editStudentFee.value) || 0;
        const payAmount = Number(editStudentPayAmount.value) || 0;

        // Add to paid fee mathematically
        const currentPaid = Number(s.paidFee) || 0;
        const newPaid = Number((currentPaid + payAmount).toFixed(2));
        const newBalance = Number((updatedFee - newPaid).toFixed(2));

        const updatedStudent = {
          studentName: editStudentName.value.trim(),
          studentClass: editStudentClass.value,
          studentFee: updatedFee,
          paidFee: newPaid,
          balanceFee: newBalance,
          photoUrl: editStudentPhotoDataUrl.value || 'https://i.ibb.co/CsP3c9Nh/school.png'
        };

        db.collection('students').doc(id).update(updatedStudent)
          .then(() => {
            closeStudentEditModal();
          })
          .catch(error => {
            alert("Error updating student: " + error.message);
          });
      });
    }

    function deleteStudent(id) {
      if (confirm('Are you sure you want to delete this student record? 🗑️')) {
        db.collection('students').doc(id).delete()
          .catch(error => {
            alert("Error deleting student: " + error.message);
          });
      }
    }

    // --- Add Activity Submit Handler ---
    if (activityForm) {
      activityForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const newActivity = {
          title: activityTitle.value.trim(),
          description: activityDescription.value.trim(),
          photoUrl: activityPhotoDataUrl.value || '',
          dateAdded: new Date().toISOString()
        };

        if (!newActivity.photoUrl) {
          alert("Please upload an image for the activity! 📸");
          return;
        }

        const customId = 'ACT-' + (1000 + Math.floor(Math.random() * 9000));

        db.collection('activities').doc(customId).set(newActivity)
          .then(() => {
            activityForm.reset();
            if (activityPhotoPreviewContainer) {
              activityPhotoPreviewContainer.style.display = 'none';
            }
            activityPhotoDataUrl.value = '';
            alert("Activity published successfully! 🌟");
          })
          .catch(error => {
            alert("Error adding activity: " + error.message);
          });
      });
    }

    // --- Render Activities Dashboard ---
    function renderActivitiesDashboard() {
      if (!activityListTableBody) return;

      if (activities.length === 0) {
        activityListTableBody.innerHTML = `
        <tr>
          <td colspan="6" class="empty-table-state">
            <span class="empty-icon">🌟</span>
            <p>No activities published yet. Add one above to display on the main page!</p>
          </td>
        </tr>
      `;
      } else {
        activityListTableBody.innerHTML = activities.map(act => {
          return `
          <tr>
            <td><strong>${act.id}</strong></td>
            <td style="text-align: center;">
              <img src="${act.photoUrl}" style="width: 50px; height: 50px; border-radius: 8px; object-fit: cover;" alt="${act.title}">
            </td>
            <td><strong>${act.title}</strong></td>
            <td>${act.description.length > 50 ? act.description.substring(0, 50) + '...' : act.description}</td>
            <td>${new Date(act.dateAdded).toLocaleDateString()}</td>
            <td class="table-actions-cell">
              <button class="action-btn delete-activity-btn" data-id="${act.id}" title="Delete Activity">🗑️</button>
            </td>
          </tr>
        `;
        }).join('');

        // Wire delete buttons
        document.querySelectorAll('.delete-activity-btn').forEach(btn => {
          btn.addEventListener('click', () => deleteActivity(btn.getAttribute('data-id')));
        });
      }
    }

    function deleteActivity(id) {
      if (confirm('Are you sure you want to delete this activity? It will be removed from the front page. 🗑️')) {
        db.collection('activities').doc(id).delete()
          .catch(error => {
            alert("Error deleting activity: " + error.message);
          });
      }
    }

    // --- Render Front-Page Activities Carousel ---
    let activityAutoTimer = null;
    function renderFrontPageActivitiesCarousel() {
      if (!activityCarouselTrack || !activityCarouselDots) return;

      if (activities.length === 0) {
        activityCarouselTrack.innerHTML = `
        <div style="text-align: center; width: 100%; color: var(--text-color); font-weight: 500; padding: 40px;">
          Check back later for exciting new activities! 🌟
        </div>
      `;
        activityCarouselDots.innerHTML = '';
        return;
      }

      // Generate HTML for actual slides
      const slidesHTML = activities.map(act => `
      <div class="carousel-slide activity-slide">
        <img src="${act.photoUrl}" alt="${act.title}" />
        <div class="activity-content">
          <h3 class="activity-title">${act.title}</h3>
          <p class="activity-desc">${act.description}</p>
        </div>
      </div>
    `).join('');

      activityCarouselTrack.innerHTML = slidesHTML;
      activityCarouselTrack.dataset.activityCount = activities.length;

      // Generate Dots (only for original number of slides)
      activityCarouselDots.innerHTML = activities.map((_, i) => `
      <span class="dot ${i === 0 ? 'active' : ''}" data-index="${i}"></span>
    `).join('');

      // Re-initialize carousel functionality for Activities
      initActivityCarousel();
    }

    function initActivityCarousel() {
      const track = document.getElementById('activityCarouselTrack');
      const prevBtn = document.getElementById('activityCarouselPrev');
      const nextBtn = document.getElementById('activityCarouselNext');
      const dots = document.querySelectorAll('#activityCarouselDots .dot');
      const TOTAL = activities.length;

      if (!track || TOTAL === 0) return;

      let currentIndex = 0;
      const INTERVAL = 3500; // ms between auto-advances

      if (activityAutoTimer) { clearInterval(activityAutoTimer); activityAutoTimer = null; }

      function getSlideWidth() {
        const slide = track.querySelector('.activity-slide');
        if (!slide) return 360;
        const gap = 20;
        return slide.offsetWidth + gap;
      }

      function goTo(index, animate = true) {
        if (TOTAL === 0) return;
        currentIndex = ((index % TOTAL) + TOTAL) % TOTAL;
        const slide = track.querySelector('.activity-slide');
        const step = getSlideWidth();
        const availableWidth = track.parentElement.clientWidth;
        const contentWidth = TOTAL * step - 20;
        const isOverflowing = contentWidth > availableWidth;
        const offset = isOverflowing ? -(currentIndex * step) : 0;
        track.style.animation = 'none'; // stop CSS animation
        track.style.transition = animate ? 'transform 0.55s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none';
        track.style.transform = isOverflowing ? `translateX(${offset}px)` : '';
        track.classList.toggle('is-overflowing', isOverflowing);

        dots.forEach((d, i) => {
          d.classList.toggle('active', i === currentIndex);
        });
      }

      function startAuto() {
        stopAuto();
        if (TOTAL < 2) return;
        activityAutoTimer = setInterval(() => {
          goTo(currentIndex + 1);
        }, INTERVAL);
      }

      function stopAuto() {
        if (activityAutoTimer) { clearInterval(activityAutoTimer); activityAutoTimer = null; }
      }

      if (prevBtn) {
        // replaceWith clone to remove old listeners in case this is called multiple times
        const newPrev = prevBtn.cloneNode(true);
        prevBtn.replaceWith(newPrev);
        newPrev.addEventListener('click', () => {
          stopAuto();
          goTo(currentIndex - 1);
          startAuto();
        });
      }

      if (nextBtn) {
        const newNext = nextBtn.cloneNode(true);
        nextBtn.replaceWith(newNext);
        newNext.addEventListener('click', () => {
          stopAuto();
          goTo(currentIndex + 1);
          startAuto();
        });
      }

      const freshDots = document.querySelectorAll('#activityCarouselDots .dot');
      freshDots.forEach((dot, i) => {
        dot.addEventListener('click', () => {
          stopAuto();
          goTo(i);
          startAuto();
        });
      });

      track.addEventListener('mouseenter', () => { stopAuto(); });
      track.addEventListener('mouseleave', () => { startAuto(); });

      if (!track.dataset.activityResizeReady) {
        track.dataset.activityResizeReady = 'true';
        window.addEventListener('resize', () => {
          goTo(currentIndex, false);
        });
      }

      // Drag / Swipe
      let dragStartX = 0;
      let isDragging = false;
      track.addEventListener('mousedown', (e) => {
        isDragging = true;
        dragStartX = e.clientX;
        stopAuto();
      });

      document.addEventListener('mouseup', (e) => {
        if (!isDragging) return;
        isDragging = false;
        const diff = dragStartX - e.clientX;
        if (Math.abs(diff) > 50) {
          goTo(diff > 0 ? currentIndex + 1 : currentIndex - 1);
        }
        startAuto();
      });

      track.addEventListener('touchstart', (e) => {
        dragStartX = e.touches[0].clientX;
        stopAuto();
      }, { passive: true });

      track.addEventListener('touchend', (e) => {
        const diff = dragStartX - e.changedTouches[0].clientX;
        if (Math.abs(diff) > 50) {
          goTo(diff > 0 ? currentIndex + 1 : currentIndex - 1);
        }
        startAuto();
      });

      // Start auto-play
      goTo(0, false);
      startAuto();
    }

    // ============================================================
    // CAROUSEL – Auto-scroll with pause on hover, nav & dots
    // ============================================================
    (function initCarousel() {
      const track = document.getElementById('carouselTrack');
      const prevBtn = document.getElementById('carouselPrev');
      const nextBtn = document.getElementById('carouselNext');
      const dots = document.querySelectorAll('#carouselDots .dot');
      const TOTAL = 6; // real slides (the track has 2 identical sets)

      if (!track) return;

      let currentIndex = 0;
      let autoTimer = null;
      const INTERVAL = 3000; // ms between auto-advances

      // --- helpers ---
      function getSlideWidth() {
        const slide = track.querySelector('.carousel-slide');
        if (!slide) return 360;
        const gap = 20;
        return slide.offsetWidth + gap;
      }

      function goTo(index, animate = true) {
        currentIndex = ((index % TOTAL) + TOTAL) % TOTAL;
        const offset = -(currentIndex * getSlideWidth());
        track.style.animation = 'none'; // stop CSS animation temporarily
        track.style.transition = animate ? 'transform 0.55s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none';
        track.style.transform = `translateX(${offset}px)`;
        updateDots();
      }

      function updateDots() {
        dots.forEach((d, i) => {
          d.classList.toggle('active', i === currentIndex);
        });
      }

      function startAuto() {
        stopAuto();
        autoTimer = setInterval(() => {
          goTo(currentIndex + 1);
        }, INTERVAL);
      }

      function stopAuto() {
        if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
      }

      // After the JS-driven slide settles, re-enable the seamless CSS scroll
      function resumeCSSScroll() {
        track.style.transition = 'none';
        track.style.transform = '';
        track.style.animation = 'carouselScroll 28s linear infinite';
      }

      // --- Navigation buttons ---
      if (prevBtn) {
        prevBtn.addEventListener('click', () => {
          stopAuto();
          goTo(currentIndex - 1);
          startAuto();
        });
      }

      if (nextBtn) {
        nextBtn.addEventListener('click', () => {
          stopAuto();
          goTo(currentIndex + 1);
          startAuto();
        });
      }

      // --- Dot clicks ---
      dots.forEach((dot, i) => {
        dot.addEventListener('click', () => {
          stopAuto();
          goTo(i);
          startAuto();
        });
      });

      // --- Pause on hover ---
      track.addEventListener('mouseenter', () => {
        track.classList.add('paused');
        stopAuto();
      });
      track.addEventListener('mouseleave', () => {
        track.classList.remove('paused');
        startAuto();
      });

      // --- Drag / swipe support ---
      let dragStartX = 0;
      let isDragging = false;

      track.addEventListener('mousedown', (e) => {
        isDragging = true;
        dragStartX = e.clientX;
        stopAuto();
      });

      document.addEventListener('mouseup', (e) => {
        if (!isDragging) return;
        isDragging = false;
        const diff = dragStartX - e.clientX;
        if (Math.abs(diff) > 50) {
          goTo(diff > 0 ? currentIndex + 1 : currentIndex - 1);
        }
        startAuto();
      });

      // Touch swipe
      track.addEventListener('touchstart', (e) => {
        dragStartX = e.touches[0].clientX;
        stopAuto();
      }, { passive: true });

      track.addEventListener('touchend', (e) => {
        const diff = dragStartX - e.changedTouches[0].clientX;
        if (Math.abs(diff) > 50) {
          goTo(diff > 0 ? currentIndex + 1 : currentIndex - 1);
        }
        startAuto();
      });

      // Start auto-play
      startAuto();
    })();

  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
  } else {
    startApp();
  }
}).catch(error => {
  window.firebaseStartupFailed = true;
  console.error('Firebase startup failed:', error);
  const activityCarouselTrack = document.getElementById('activityCarouselTrack');
  if (activityCarouselTrack) {
    activityCarouselTrack.innerHTML = `
      <div class="activity-status-message">
        Activities are temporarily unavailable. Please check back soon.
      </div>
    `;
  }
});

