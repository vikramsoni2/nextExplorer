/**
 * Infrastructure Test
 * Tests the database, repositories, and core services
 * Run with: node tests/infrastructure-test.js
 */

const path = require('path');
const fs = require('fs');

// Set test environment
process.env.NODE_ENV = 'test';
process.env.CONFIG_DIR = path.join(__dirname, '.test-config');
process.env.CACHE_DIR = path.join(__dirname, '.test-cache');
process.env.VOLUME_ROOT = path.join(__dirname, '.test-volume');

const { getDb, closeDb, getRepositories } = require('../src/infrastructure/database');
const { AuthService } = require('../src/core/domains/auth');
const { UsersService } = require('../src/core/domains/users');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
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

async function runTests() {
  let db;
  let repositories;
  let authService;
  let usersService;
  let testUser;

  try {
    log('\n======================================', 'blue');
    log('  Infrastructure Test Suite', 'blue');
    log('======================================\n', 'blue');

    // Test 1: Database Initialization
    logTest('Test 1: Database Initialization');
    try {
      db = await getDb();
      logPass('Database initialized');
      logPass('Migrations completed');
    } catch (error) {
      logFail(`Database initialization failed: ${error.message}`);
      throw error;
    }

    // Test 2: Repository Initialization
    logTest('Test 2: Repository Initialization');
    try {
      repositories = await getRepositories();
      logPass('Repositories initialized');
      logPass(`Users repository: ${repositories.users.constructor.name}`);
      logPass(`AuthMethods repository: ${repositories.authMethods.constructor.name}`);
      logPass(`AuthLocks repository: ${repositories.authLocks.constructor.name}`);
    } catch (error) {
      logFail(`Repository initialization failed: ${error.message}`);
      throw error;
    }

    // Test 3: Service Initialization
    logTest('Test 3: Service Initialization');
    try {
      authService = new AuthService(repositories);
      usersService = new UsersService(repositories);
      logPass('AuthService initialized');
      logPass('UsersService initialized');
    } catch (error) {
      logFail(`Service initialization failed: ${error.message}`);
      throw error;
    }

    // Test 4: User Creation
    logTest('Test 4: User Creation');
    try {
      testUser = await usersService.createFirstAdmin({
        email: 'test@example.com',
        username: 'testadmin',
        password: 'TestPassword123'
      });

      logPass(`User created with ID: ${testUser.id}`);
      logPass(`Email: ${testUser.email}`);
      logPass(`Roles: ${testUser.roles.join(', ')}`);

      // Verify user was saved
      const retrieved = usersService.getById(testUser.id);
      if (retrieved && retrieved.email === testUser.email) {
        logPass('User successfully retrieved from database');
      } else {
        throw new Error('User retrieval failed');
      }
    } catch (error) {
      logFail(`User creation failed: ${error.message}`);
      throw error;
    }

    // Test 5: User Count
    logTest('Test 5: User Count');
    try {
      const userCount = usersService.countUsers();
      const adminCount = usersService.countAdmins();

      if (userCount === 1) {
        logPass(`User count: ${userCount}`);
      } else {
        throw new Error(`Expected 1 user, got ${userCount}`);
      }

      if (adminCount === 1) {
        logPass(`Admin count: ${adminCount}`);
      } else {
        throw new Error(`Expected 1 admin, got ${adminCount}`);
      }
    } catch (error) {
      logFail(`User count test failed: ${error.message}`);
      throw error;
    }

    // Test 6: Authentication - Success
    logTest('Test 6: Authentication - Success');
    try {
      const authenticatedUser = await authService.authenticateWithPassword(
        'test@example.com',
        'TestPassword123'
      );

      if (authenticatedUser && authenticatedUser.id === testUser.id) {
        logPass('Authentication successful');
        logPass(`Authenticated user ID: ${authenticatedUser.id}`);
      } else {
        throw new Error('Authentication failed to return correct user');
      }
    } catch (error) {
      logFail(`Authentication test failed: ${error.message}`);
      throw error;
    }

    // Test 7: Authentication - Wrong Password
    logTest('Test 7: Authentication - Wrong Password');
    try {
      await authService.authenticateWithPassword(
        'test@example.com',
        'WrongPassword'
      );
      logFail('Should have thrown InvalidCredentialsError');
      throw new Error('Authentication should have failed');
    } catch (error) {
      if (error.code === 'INVALID_CREDENTIALS') {
        logPass('Correctly rejected wrong password');
      } else {
        throw error;
      }
    }

    // Test 8: Account Lockout
    logTest('Test 8: Account Lockout');
    try {
      // Attempt login 5 times with wrong password
      for (let i = 0; i < 5; i++) {
        try {
          await authService.authenticateWithPassword(
            'lockout@example.com',
            'WrongPassword'
          );
        } catch (error) {
          // Expected to fail
        }
      }

      // Create a user to test lockout
      await usersService.createLocalUser({
        email: 'lockout@example.com',
        username: 'lockout',
        password: 'TestPassword123'
      });

      // Try 5 failed attempts
      for (let i = 0; i < 5; i++) {
        try {
          await authService.authenticateWithPassword(
            'lockout@example.com',
            'WrongPassword'
          );
        } catch (error) {
          // Expected to fail
        }
      }

      // 6th attempt should be locked
      try {
        await authService.authenticateWithPassword(
          'lockout@example.com',
          'TestPassword123'
        );
        logFail('Should have thrown AccountLockedError');
      } catch (error) {
        if (error.code === 'ACCOUNT_LOCKED') {
          logPass('Account correctly locked after 5 failed attempts');
        } else {
          throw error;
        }
      }
    } catch (error) {
      logFail(`Account lockout test failed: ${error.message}`);
      throw error;
    }

    // Test 9: Password Change
    logTest('Test 9: Password Change');
    try {
      await usersService.changePassword(
        testUser.id,
        'TestPassword123',
        'NewPassword456'
      );
      logPass('Password changed successfully');

      // Verify new password works
      const authenticated = await authService.authenticateWithPassword(
        'test@example.com',
        'NewPassword456'
      );

      if (authenticated) {
        logPass('New password authentication successful');
      } else {
        throw new Error('New password authentication failed');
      }
    } catch (error) {
      logFail(`Password change test failed: ${error.message}`);
      throw error;
    }

    // Success!
    log('\n======================================', 'green');
    log('  All Tests Passed! ✓', 'green');
    log('======================================\n', 'green');

  } catch (error) {
    log('\n======================================', 'red');
    log('  Tests Failed! ✗', 'red');
    log('======================================\n', 'red');
    console.error(error);
    process.exit(1);
  } finally {
    // Cleanup
    if (db) {
      closeDb();
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
