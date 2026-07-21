import { FUSION_CONTRACT_VERSION, type StudentProfile } from './contracts';
import type { FusionProfileProvider, StudentProfileRequest } from './provider';

function isoNow(): string {
  return new Date().toISOString();
}

function createFoundationProfile(learnerId: string): StudentProfile {
  return {
    contractVersion: FUSION_CONTRACT_VERSION,
    learnerId,
    displayName: 'Demo 学生 A',
    source: 'mock',
    knowledgeState: [
      {
        knowledgePointId: 'linear-function-graph',
        name: '一次函数图像与基本变化趋势',
        mastery: 0.78,
      },
      {
        knowledgePointId: 'linear-function-slope-intercept',
        name: '斜率与截距的现实含义',
        mastery: 0.38,
      },
      {
        knowledgePointId: 'linear-function-modeling',
        name: '由实际情境建立函数关系',
        mastery: 0.42,
      },
    ],
    strengths: ['能够从图像判断函数的增减趋势'],
    weakPoints: ['斜率与截距的现实含义', '由实际情境建立函数关系'],
    learningPreferences: {
      preferredExamples: ['生活化的计费或路程问题'],
      preferredRepresentations: ['concrete', 'visual', 'step_by_step'],
      pace: 'slow',
    },
    recentMisconceptions: [
      {
        knowledgePointId: 'linear-function-slope-intercept',
        knowledgePoint: '斜率与截距的现实含义',
        errorType: 'deviation',
        description: '容易把斜率和纵轴截距都理解成“初始数量”。',
      },
    ],
    updatedAt: isoNow(),
  };
}

function createAdvancedProfile(learnerId: string): StudentProfile {
  return {
    contractVersion: FUSION_CONTRACT_VERSION,
    learnerId,
    displayName: 'Demo 学生 B',
    source: 'mock',
    knowledgeState: [
      {
        knowledgePointId: 'linear-function-graph',
        name: '一次函数图像与基本变化趋势',
        mastery: 0.93,
      },
      {
        knowledgePointId: 'linear-function-slope-intercept',
        name: '斜率与截距的现实含义',
        mastery: 0.88,
      },
      {
        knowledgePointId: 'linear-function-modeling',
        name: '由实际情境建立函数关系',
        mastery: 0.81,
      },
    ],
    strengths: ['能在图像、解析式和实际情境之间转换', '能独立解释斜率与截距'],
    weakPoints: [],
    learningPreferences: {
      preferredExamples: ['带有约束条件的真实问题'],
      preferredRepresentations: ['formula', 'visual'],
      pace: 'fast',
    },
    recentMisconceptions: [],
    updatedAt: isoNow(),
  };
}

/** Offline provider for repeatable demos and local development. */
export class MockFusionProfileProvider implements FusionProfileProvider {
  readonly id = 'mock';

  async getStudentProfile({ learnerId }: StudentProfileRequest): Promise<StudentProfile> {
    return learnerId === 'demo-student-b'
      ? createAdvancedProfile(learnerId)
      : createFoundationProfile(learnerId);
  }
}
