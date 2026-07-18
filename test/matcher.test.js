import test from 'node:test';
import assert from 'node:assert/strict';
import { extractExperience, matchJob } from '../src/matcher.js';

test('matches a Java backend role in Bengaluru with suitable experience', () => {
  const result = matchJob({
    title: 'Software Engineer II - Java Backend',
    location: 'Bengaluru, Karnataka, India',
    description: 'Requires 2-4 years of experience building Java Spring Boot microservices with Kafka, SQL, Docker and Kubernetes.',
  });
  assert.equal(result.matched, true);
  assert.deepEqual(result.skills.slice(0, 3), ['Java', 'Spring Boot', 'Kafka']);
  assert.match(result.experience, /2-4 years/i);
});

test('rejects staff, principal and manager roles', () => {
  for (const title of ['Staff Software Engineer', 'Principal Backend Engineer', 'Engineering Manager, Platform']) {
    assert.equal(matchJob({ title, location: 'India', description: 'Java, 3 years experience' }).matched, false);
  }
});

test('rejects off-profile specializations and higher numbered levels', () => {
  for (const title of ['Embedded Software Engineer', 'Software Engineer, Firmware', 'Software Engineer, PhD, Early Career', 'Software Engineer III', 'Software Development Engineer-III', 'Software Engineer II (Software Engineer in Test)', 'Software Engineer, C++', 'Software Engineer - SRE (Rust)', 'Software Engineer, React Native', 'Verification and Validation Software Engineer']) {
    assert.equal(matchJob({ title, location: 'Bengaluru, India', description: 'Java Spring Boot microservices with Kafka. 2 years of experience.' }).matched, false);
  }
});

test('returns structured, explainable rejection reason codes', () => {
  const result = matchJob({ title: 'Lead Software Engineer', location: 'Pune, India', description: 'Java Spring Boot, 3 years experience' });
  assert.equal(result.matched, false);
  assert.equal(result.reasonCode, 'SENIORITY_EXCLUDED');
  assert.match(result.rejection.details, /excluded/i);
});

test('requires at least one matching stack skill', () => {
  assert.equal(matchJob({ title: 'Software Engineer II', location: 'India', description: 'Develop C++ graphics systems. 2 years of experience.' }).matched, false);
});

test('rejects roles clearly requiring five or more years', () => {
  const result = matchJob({ title: 'Java Developer', location: 'Hyderabad, India', description: 'Minimum 5 years of experience in Java and Spring Boot.' });
  assert.equal(result.matched, false);
  assert.equal(result.reason, 'experience');
});

test('allows experience-unspecified non-senior target roles', () => {
  const result = matchJob({ title: 'Application Developer', location: 'Pune, India', description: 'Build REST APIs using Java and SQL.' });
  assert.equal(result.matched, true);
  assert.equal(result.experience, 'Not specified');
});

test('only allows senior roles when backend-focused and explicitly compatible', () => {
  assert.equal(matchJob({ title: 'Senior Software Engineer, Backend', location: 'Remote - India', description: 'Java and Kafka. 3+ years of experience.' }).matched, true);
  assert.equal(matchJob({ title: 'Senior Software Engineer', location: 'India', description: 'Frontend systems. Experience not specified.' }).matched, false);
  assert.equal(matchJob({ title: 'Senior System Software Engineer - DevOps and Test Labs', location: 'Pune, India', description: 'Java and REST APIs. 3+ years of experience.' }).matched, false);
});

test('extracts common experience formats', () => {
  const value = extractExperience('Applicants need at least 2 years of experience; 2-4 years preferred.');
  assert.equal(value.ranges.length >= 2, true);
});
