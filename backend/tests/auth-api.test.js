/**
 * Auth API Integration Test
 * Tests the complete auth flow via HTTP
 * Run with: node tests/auth-api.test.js
 */

const path = require('path');
const fs = require('fs');
const http = require('http');

// Set test environment
process.env.NODE_ENV = 'test';
process.env.CONFIG_DIR = path.join(__dirname, '.test-api-config');
process.env.CACHE_DIR = path.join(__dirname, '.test-api-cache');
process.env.VOLUME_ROOT = path.join(__dirname, '.test-api-volume');
process.env.PORT = 3001; // Use different port for testing

const { initializeApp } = require('../src/app');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  blue: '\x1b[34m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logTest(name) {
  console.log(`\n${colors.blue}► ${name}${colors.reset}`);
}

function logPass(message) {
  log(`  ✓ ${message}`, 'green');
}

function logFail(message) {
  log(`  ✗ ${message}`, 'red');
}

// Cleanup function
function cleanup() {
  const configDir = process.env.CONFIG_DIR;
  const cacheDir = process.env.CACHE_DIR;
  const volumeDir = process.env.VOLUME_ROOT;

  [configDir, cacheDir, volumeDir].forEach(dir => {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

// HTTP request helper
function request(method, path, body = null, cookie = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (cookie) {
      options.headers['Cookie'] = cookie;
    }

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: parsed,
            cookie: res.headers['set-cookie']
          });
        } catch (error) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data,
            cookie: res.headers['set-cookie']
          });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

async function runTests() {
  let server;
  let sessionCookie;

  try {
    log('\n======================================', 'blue');
    log('  Auth API Integration Test', 'blue');
    log('======================================\n', 'blue');

    // Start server
    logTest('Starting Server');
    const app = await initializeApp();
    server = app.listen(3001, () => {
      logPass('Server started on port 3001');
    });

    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test 1: Health Check
    logTest('Test 1: Health Check');
    const healthRes = await request('GET', '/health');
    if (healthRes.statusCode === 200 && healthRes.body.status === 'ok') {
      logPass('Health check passed');
    } else {
      logFail(`Health check failed: ${healthRes.statusCode}`);
      throw new Error('Health check failed');
    }

    // Test 2: Get Auth Status (before setup)
    logTest('Test 2: Get Auth Status (before setup)');
    const statusRes1 = await request('GET', '/api/v1/auth/status');
    if (statusRes1.statusCode === 200) {
      logPass(`Status code: ${statusRes1.statusCode}`);
      logPass(`Setup required: ${statusRes1.body.data.setupRequired}`);
      logPass(`Auth modes: ${statusRes1.body.data.authModes}`);

      if (!statusRes1.body.data.setupRequired) {
        logFail('Setup should be required');
        throw new Error('Setup should be required');
      }
    } else {
      logFail(`Failed: ${statusRes1.statusCode}`);
      throw new Error('Status check failed');
    }

    // Test 3: Setup (Create First Admin)
    logTest('Test 3: Setup - Create First Admin');
    const setupRes = await request('POST', '/api/v1/auth/setup', {
      email: 'admin@example.com',
      username: 'admin',
      password: 'AdminPass123'
    });

    if (setupRes.statusCode === 201) {
      logPass(`Status code: ${setupRes.statusCode}`);
      logPass(`User created: ${setupRes.body.data.user.email}`);
      logPass(`Roles: ${setupRes.body.data.user.roles.join(', ')}`);

      // Save session cookie
      if (setupRes.cookie) {
        sessionCookie = setupRes.cookie[0].split(';')[0];
        logPass('Session cookie received');
      }
    } else {
      logFail(`Setup failed: ${setupRes.statusCode}`);
      console.log(setupRes.body);
      throw new Error('Setup failed');
    }

    // Test 4: Login with Wrong Password
    logTest('Test 4: Login with Wrong Password');
    const loginFailRes = await request('POST', '/api/v1/auth/login', {
      email: 'admin@example.com',
      password: 'WrongPassword'
    });

    if (loginFailRes.statusCode === 401) {
      logPass('Correctly rejected wrong password');
      logPass(`Error code: ${loginFailRes.body.error.code}`);
    } else {
      logFail(`Expected 401, got ${loginFailRes.statusCode}`);
      throw new Error('Should have rejected wrong password');
    }

    // Test 5: Login with Correct Password
    logTest('Test 5: Login with Correct Password');
    const loginRes = await request('POST', '/api/v1/auth/login', {
      email: 'admin@example.com',
      password: 'AdminPass123'
    });

    if (loginRes.statusCode === 200) {
      logPass(`Status code: ${loginRes.statusCode}`);
      logPass(`User: ${loginRes.body.data.user.email}`);

      // Update session cookie
      if (loginRes.cookie) {
        sessionCookie = loginRes.cookie[0].split(';')[0];
        logPass('New session cookie received');
      }
    } else {
      logFail(`Login failed: ${loginRes.statusCode}`);
      console.log(loginRes.body);
      throw new Error('Login failed');
    }

    // Test 6: Get Current User
    logTest('Test 6: Get Current User');
    const meRes = await request('GET', '/api/v1/auth/me', null, sessionCookie);

    if (meRes.statusCode === 200) {
      logPass(`Status code: ${meRes.statusCode}`);
      logPass(`Current user: ${meRes.body.data.email}`);
      logPass(`Roles: ${meRes.body.data.roles.join(', ')}`);
    } else {
      logFail(`Get current user failed: ${meRes.statusCode}`);
      console.log(meRes.body);
      throw new Error('Get current user failed');
    }

    // Test 7: Access Protected Route Without Auth
    logTest('Test 7: Access Protected Route Without Auth');
    const noAuthRes = await request('GET', '/api/v1/auth/me');

    if (noAuthRes.statusCode === 401) {
      logPass('Correctly rejected unauthenticated request');
      logPass(`Error code: ${noAuthRes.body.error.code}`);
    } else {
      logFail(`Expected 401, got ${noAuthRes.statusCode}`);
      throw new Error('Should have rejected unauthenticated request');
    }

    // Test 8: Change Password
    logTest('Test 8: Change Password');
    const changePassRes = await request('POST', '/api/v1/auth/password', {
      currentPassword: 'AdminPass123',
      newPassword: 'NewAdminPass456'
    }, sessionCookie);

    if (changePassRes.statusCode === 200) {
      logPass('Password changed successfully');
      logPass(`Message: ${changePassRes.body.data.message}`);
    } else {
      logFail(`Password change failed: ${changePassRes.statusCode}`);
      console.log(changePassRes.body);
      throw new Error('Password change failed');
    }

    // Test 9: Login with New Password
    logTest('Test 9: Login with New Password');
    const newLoginRes = await request('POST', '/api/v1/auth/login', {
      email: 'admin@example.com',
      password: 'NewAdminPass456'
    });

    if (newLoginRes.statusCode === 200) {
      logPass('Login with new password successful');
      sessionCookie = newLoginRes.cookie[0].split(';')[0];
    } else {
      logFail(`Login with new password failed: ${newLoginRes.statusCode}`);
      throw new Error('Login with new password failed');
    }

    // Test 10: Logout
    logTest('Test 10: Logout');
    const logoutRes = await request('POST', '/api/v1/auth/logout', null, sessionCookie);

    if (logoutRes.statusCode === 200) {
      logPass('Logout successful');
    } else {
      logFail(`Logout failed: ${logoutRes.statusCode}`);
      throw new Error('Logout failed');
    }

    // Test 11: Verify Session Destroyed
    logTest('Test 11: Verify Session Destroyed');
    const afterLogoutRes = await request('GET', '/api/v1/auth/me', null, sessionCookie);

    if (afterLogoutRes.statusCode === 401) {
      logPass('Session correctly destroyed after logout');
    } else {
      logFail(`Expected 401, got ${afterLogoutRes.statusCode}`);
      throw new Error('Session should be destroyed');
    }

    // Success!
    log('\n======================================', 'green');
    log('  All API Tests Passed! ✓', 'green');
    log('======================================\n', 'green');

  } catch (error) {
    log('\n======================================', 'red');
    log('  API Tests Failed! ✗', 'red');
    log('======================================\n', 'red');
    console.error(error);
    process.exit(1);
  } finally {
    // Cleanup
    if (server) {
      server.close();
    }
    cleanup();
  }
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  cleanup();
  process.exit(1);
});
