#!/usr/bin/env node

// Test Suite for Audio Flow Plugins
// Tests the flow plugins with various scenarios

const fs = require('fs');
const path = require('path');

// Mock Tdarr flow args structure for testing
function createMockFlowArgs(streams, variables = {}) {
  return {
    inputFileObj: {
      _id: '/test/sample.mkv',
      file: '/test/sample.mkv',
      container: 'mkv',
      file_size: 1000000000,
      ffProbeData: {
        streams: streams
      }
    },
    variables: variables,
    jobLog: (message) => console.log(`[LOG] ${message}`)
  };
}

// Test scenarios
const TEST_SCENARIOS = {
  // Scenario 1: Multiple English streams (should route to output 1)
  multipleEnglish: [
    { codec_type: 'video', codec_name: 'h264', index: 0 },
    { codec_type: 'audio', codec_name: 'dts', index: 1, channels: 6, tags: { language: 'eng' } },
    { codec_type: 'audio', codec_name: 'ac3', index: 2, channels: 2, tags: { language: 'eng' } },
    { codec_type: 'audio', codec_name: 'dts', index: 3, channels: 6, tags: { language: 'spa' } },
    { codec_type: 'subtitle', codec_name: 'subrip', index: 4, tags: { language: 'eng' } }
  ],

  // Scenario 2: Single English stream (should route to output 2)
  singleEnglish: [
    { codec_type: 'video', codec_name: 'h264', index: 0 },
    { codec_type: 'audio', codec_name: 'dts', index: 1, channels: 6, tags: { language: 'eng' } },
    { codec_type: 'audio', codec_name: 'dts', index: 2, channels: 6, tags: { language: 'spa' } },
    { codec_type: 'subtitle', codec_name: 'subrip', index: 3, tags: { language: 'eng' } }
  ],

  // Scenario 3: No English streams (should route to output 2)
  noEnglish: [
    { codec_type: 'video', codec_name: 'h264', index: 0 },
    { codec_type: 'audio', codec_name: 'dts', index: 1, channels: 6, tags: { language: 'spa' } },
    { codec_type: 'audio', codec_name: 'ac3', index: 2, channels: 2, tags: { language: 'fra' } },
    { codec_type: 'subtitle', codec_name: 'subrip', index: 3, tags: { language: 'spa' } }
  ],

  // Scenario 4: Undefined language streams (should route to output 3)
  undefinedLanguage: [
    { codec_type: 'video', codec_name: 'h264', index: 0 },
    { codec_type: 'audio', codec_name: 'dts', index: 1, channels: 6, tags: { language: 'eng' } },
    { codec_type: 'audio', codec_name: 'ac3', index: 2, channels: 2, tags: { language: 'und' } },
    { codec_type: 'subtitle', codec_name: 'subrip', index: 3, tags: { language: 'eng' } }
  ],

  // Scenario 5: No audio streams (should route to output 2)
  noAudio: [
    { codec_type: 'video', codec_name: 'h264', index: 0 },
    { codec_type: 'subtitle', codec_name: 'subrip', index: 1, tags: { language: 'eng' } }
  ],

  // Scenario 6: Complex multi-language with multiple English (should route to output 1)
  complexMultiLanguage: [
    { codec_type: 'video', codec_name: 'h264', index: 0 },
    { codec_type: 'audio', codec_name: 'dts', index: 1, channels: 8, tags: { language: 'eng' } },
    { codec_type: 'audio', codec_name: 'ac3', index: 2, channels: 6, tags: { language: 'eng' } },
    { codec_type: 'audio', codec_name: 'aac', index: 3, channels: 2, tags: { language: 'eng' } },
    { codec_type: 'audio', codec_name: 'dts', index: 4, channels: 6, tags: { language: 'spa' } },
    { codec_type: 'audio', codec_name: 'ac3', index: 5, channels: 2, tags: { language: 'fra' } },
    { codec_type: 'audio', codec_name: 'dts', index: 6, channels: 6, tags: { language: 'deu' } },
    { codec_type: 'subtitle', codec_name: 'subrip', index: 7, tags: { language: 'eng' } }
  ]
};

class FlowPluginsTester {
  constructor() {
    this.checkPlugin = null;
    this.testResults = [];
  }

  async loadPlugins() {
    try {
      // Load the check plugin
      if (fs.existsSync('./check-audio-english-duplicates.js')) {
        this.checkPlugin = require('./check-audio-english-duplicates.js');
        console.log('✓ Loaded check-audio-english-duplicates.js');
      } else {
        throw new Error('check-audio-english-duplicates.js not found');
      }

    } catch (error) {
      console.error(`❌ Failed to load plugins: ${error.message}`);
      throw error;
    }
  }

  async runTests() {
    console.log('═══════════════════════════════════════');
    console.log('   FLOW PLUGINS TEST SUITE');
    console.log('═══════════════════════════════════════');
    console.log('Testing audio flow plugins\n');

    await this.loadPlugins();

    // Test each scenario
    for (const [scenarioName, streams] of Object.entries(TEST_SCENARIOS)) {
      await this.testScenario(scenarioName, streams);
    }

    // Print summary
    this.printSummary();
  }

  async testScenario(scenarioName, streams) {
    console.log(`\n━━━ Testing: ${scenarioName} ━━━`);
    
    const testResult = {
      scenario: scenarioName,
      checkPlugin: { success: false, output: null, error: null },
      expectedOutput: this.getExpectedOutput(scenarioName),
      actualOutput: null
    };

    try {
      // Test check plugin
      console.log('Testing check plugin...');
      const mockArgs = createMockFlowArgs(streams);
      const checkResult = await this.checkPlugin(mockArgs);
      
      testResult.checkPlugin.success = true;
      testResult.checkPlugin.output = checkResult;
      testResult.actualOutput = checkResult.outputNumber;
      
      console.log(`Check plugin result: outputNumber=${checkResult.outputNumber}`);
      
      // Verify variables were set correctly
      if (checkResult.variables && checkResult.variables.audioStreamAnalysis) {
        const analysis = checkResult.variables.audioStreamAnalysis;
        console.log(`Analysis: ${analysis.englishStreams} English, ${analysis.otherLanguageStreams} other, ${analysis.undefinedStreams} undefined`);
      }
      
      // Check if output matches expectation
      const outputMatches = testResult.actualOutput === testResult.expectedOutput;
      console.log(`Expected output: ${testResult.expectedOutput}`);
      console.log(`Actual output: ${testResult.actualOutput}`);
      console.log(`Result: ${outputMatches ? '✅ PASS' : '❌ FAIL'}`);
      
      testResult.passed = outputMatches;

    } catch (error) {
      console.error(`❌ Test failed with error: ${error.message}`);
      testResult.checkPlugin.error = error.message;
      testResult.actualOutput = 'ERROR';
      testResult.passed = false;
    }

    this.testResults.push(testResult);
  }

  getExpectedOutput(scenarioName) {
    const expectations = {
      multipleEnglish: 1,        // Multiple English → Process
      singleEnglish: 2,          // Single English → Skip
      noEnglish: 2,              // No English → Skip
      undefinedLanguage: 3,      // Undefined language → Skip (safety)
      noAudio: 2,                // No audio → Skip
      complexMultiLanguage: 1    // Multiple English → Process
    };
    return expectations[scenarioName] || 0;
  }

  printSummary() {
    console.log('\n═══════════════════════════════════════');
    console.log('   TEST RESULTS SUMMARY');
    console.log('═══════════════════════════════════════');

    const passed = this.testResults.filter(r => r.passed).length;
    const total = this.testResults.length;
    
    console.log(`\nOverall: ${passed}/${total} tests passed\n`);

    this.testResults.forEach(result => {
      const status = result.passed ? '✅ PASS' : '❌ FAIL';
      console.log(`${status} ${result.scenario}`);
      console.log(`  Expected output: ${result.expectedOutput}`);
      console.log(`  Actual output: ${result.actualOutput}`);
      
      if (result.checkPlugin.error) {
        console.log(`  Error: ${result.checkPlugin.error}`);
      }
      console.log('');
    });

    // Detailed analysis for failures
    if (passed < total) {
      console.log('━━━ Failed Test Analysis ━━━');
      this.testResults
        .filter(r => !r.passed)
        .forEach(result => {
          console.log(`\n${result.scenario}:`);
          if (result.checkPlugin.output) {
            console.log(`  Output number: ${result.checkPlugin.output.outputNumber}`);
            if (result.checkPlugin.output.variables && result.checkPlugin.output.variables.audioStreamAnalysis) {
              const analysis = result.checkPlugin.output.variables.audioStreamAnalysis;
              console.log(`  Analysis: ${analysis.englishStreams} English, ${analysis.otherLanguageStreams} other, ${analysis.undefinedStreams} undefined`);
            }
          }
        });
    }

    console.log(`\n🎯 Test Suite ${passed === total ? 'PASSED' : 'FAILED'}`);
    
    if (passed === total) {
      console.log('All flow plugins are working correctly!');
      console.log('\n📋 Usage in Tdarr Flow:');
      console.log('1. Add "check-audio-english-duplicates.js" as a flow block');
      console.log('2. Connect output 1 to "audio-english-deduplicator-flow.js" for processing');
      console.log('3. Connect outputs 2 and 3 to skip/next processing steps');
    } else {
      console.log(`${total - passed} test(s) failed. Please review the implementation.`);
    }
  }
}

// Run tests if called directly
if (require.main === module) {
  const tester = new FlowPluginsTester();
  tester.runTests().catch(error => {
    console.error(`Fatal test error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = FlowPluginsTester;
