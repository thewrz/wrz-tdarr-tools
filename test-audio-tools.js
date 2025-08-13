#!/usr/bin/env node

// Test Suite for Audio Channel Management Tools
// Tests the deduplicator and processor tools with various scenarios

const fs = require('fs');
const path = require('path');

// Mock Tdarr args structure for testing
function createMockArgs(streams, variables = {}) {
  return {
    inputFileObj: {
      _id: '/test/sample.mkv',
      path: '/test/sample.mkv',
      sourceFile: '/test/sample.mkv',
      container: 'mkv',
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
  // Scenario 1: Multiple English streams (should process)
  multipleEnglish: [
    { codec_type: 'video', codec_name: 'h264', index: 0 },
    { codec_type: 'audio', codec_name: 'dts', index: 1, channels: 6, tags: { language: 'eng' } },
    { codec_type: 'audio', codec_name: 'ac3', index: 2, channels: 2, tags: { language: 'eng' } },
    { codec_type: 'audio', codec_name: 'dts', index: 3, channels: 6, tags: { language: 'spa' } },
    { codec_type: 'subtitle', codec_name: 'subrip', index: 4, tags: { language: 'eng' } }
  ],

  // Scenario 2: Single English stream (should skip)
  singleEnglish: [
    { codec_type: 'video', codec_name: 'h264', index: 0 },
    { codec_type: 'audio', codec_name: 'dts', index: 1, channels: 6, tags: { language: 'eng' } },
    { codec_type: 'audio', codec_name: 'dts', index: 2, channels: 6, tags: { language: 'spa' } },
    { codec_type: 'subtitle', codec_name: 'subrip', index: 3, tags: { language: 'eng' } }
  ],

  // Scenario 3: No English streams (should skip)
  noEnglish: [
    { codec_type: 'video', codec_name: 'h264', index: 0 },
    { codec_type: 'audio', codec_name: 'dts', index: 1, channels: 6, tags: { language: 'spa' } },
    { codec_type: 'audio', codec_name: 'ac3', index: 2, channels: 2, tags: { language: 'fra' } },
    { codec_type: 'subtitle', codec_name: 'subrip', index: 3, tags: { language: 'spa' } }
  ],

  // Scenario 4: Undefined language streams (should skip)
  undefinedLanguage: [
    { codec_type: 'video', codec_name: 'h264', index: 0 },
    { codec_type: 'audio', codec_name: 'dts', index: 1, channels: 6, tags: { language: 'eng' } },
    { codec_type: 'audio', codec_name: 'ac3', index: 2, channels: 2, tags: { language: 'und' } },
    { codec_type: 'subtitle', codec_name: 'subrip', index: 3, tags: { language: 'eng' } }
  ],

  // Scenario 5: No audio streams (should skip)
  noAudio: [
    { codec_type: 'video', codec_name: 'h264', index: 0 },
    { codec_type: 'subtitle', codec_name: 'subrip', index: 1, tags: { language: 'eng' } }
  ],

  // Scenario 6: Complex multi-language with multiple English (should process)
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

class AudioToolsTester {
  constructor() {
    this.deduplicator = null;
    this.processor = null;
    this.testResults = [];
  }

  async loadTools() {
    try {
      // Load the deduplicator tool
      if (fs.existsSync('./audio-english-deduplicator.js')) {
        this.deduplicator = require('./audio-english-deduplicator.js');
        console.log('✓ Loaded audio-english-deduplicator.js');
      } else {
        throw new Error('audio-english-deduplicator.js not found');
      }

      // Load the processor tool
      if (fs.existsSync('./audio-english-processor.js')) {
        this.processor = require('./audio-english-processor.js');
        console.log('✓ Loaded audio-english-processor.js');
      } else {
        throw new Error('audio-english-processor.js not found');
      }

    } catch (error) {
      console.error(`❌ Failed to load tools: ${error.message}`);
      throw error;
    }
  }

  async runTests() {
    console.log('═══════════════════════════════════════');
    console.log('   AUDIO TOOLS TEST SUITE');
    console.log('═══════════════════════════════════════');
    console.log('Testing audio channel management tools\n');

    await this.loadTools();

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
      deduplicator: { success: false, output: null, error: null },
      processor: { success: false, output: null, error: null },
      expectedBehavior: this.getExpectedBehavior(scenarioName),
      actualBehavior: null
    };

    try {
      // Test deduplicator
      console.log('Testing deduplicator...');
      const mockArgs = createMockArgs(streams);
      const deduplicatorResult = await this.deduplicator(mockArgs);
      
      testResult.deduplicator.success = true;
      testResult.deduplicator.output = deduplicatorResult;
      
      console.log(`Deduplicator result: outputNumber=${deduplicatorResult.outputNumber}, processFile=${deduplicatorResult.processFile}`);
      
      // If deduplicator says to process, test processor
      if (deduplicatorResult.processFile && deduplicatorResult.outputNumber === 1) {
        console.log('Testing processor...');
        
        // Mock the variables that would be set by deduplicator
        const processorArgs = createMockArgs(streams, {
          ...mockArgs.variables,
          skipProcessing: false,
          needsProcessing: true,
          audioAnalysis: this.mockAnalysis(streams),
          originalFile: mockArgs.inputFileObj.path,
          containerType: 'mkv',
          preferredTool: 'mkvtoolnix'
        });
        
        const processorResult = await this.processor(processorArgs);
        
        testResult.processor.success = true;
        testResult.processor.output = processorResult;
        
        console.log(`Processor result: outputNumber=${processorResult.outputNumber}, processFile=${processorResult.processFile}`);
      } else {
        console.log('Processor not tested (deduplicator skipped processing)');
      }

      // Determine actual behavior
      testResult.actualBehavior = this.determineActualBehavior(testResult);
      
      // Check if behavior matches expectation
      const behaviorMatches = testResult.actualBehavior === testResult.expectedBehavior;
      console.log(`Expected: ${testResult.expectedBehavior}`);
      console.log(`Actual: ${testResult.actualBehavior}`);
      console.log(`Result: ${behaviorMatches ? '✅ PASS' : '❌ FAIL'}`);
      
      testResult.passed = behaviorMatches;

    } catch (error) {
      console.error(`❌ Test failed with error: ${error.message}`);
      testResult.deduplicator.error = error.message;
      testResult.actualBehavior = 'ERROR';
      testResult.passed = false;
    }

    this.testResults.push(testResult);
  }

  mockAnalysis(streams) {
    const audioStreams = streams.filter(s => s.codec_type === 'audio');
    const analysis = {
      englishStreams: [],
      otherLanguageStreams: [],
      undefinedStreams: [],
      streamsToKeep: [],
      streamsToRemove: []
    };

    audioStreams.forEach((stream, index) => {
      const language = (stream.tags?.language || 'und').toLowerCase();
      const streamInfo = {
        index: stream.index,
        streamIndex: index,
        language: language,
        channels: stream.channels || 0,
        codec: stream.codec_name || 'unknown'
      };

      if (language === 'eng' || language === 'en' || language === 'english') {
        analysis.englishStreams.push(streamInfo);
      } else if (language === 'und' || language === 'undefined') {
        analysis.undefinedStreams.push(streamInfo);
      } else {
        analysis.otherLanguageStreams.push(streamInfo);
      }
    });

    // Simulate the logic for streams to keep/remove
    if (analysis.englishStreams.length > 1) {
      analysis.streamsToKeep.push(analysis.englishStreams[0]);
      analysis.streamsToRemove = analysis.englishStreams.slice(1);
      analysis.streamsToKeep.push(...analysis.otherLanguageStreams);
    }

    return analysis;
  }

  getExpectedBehavior(scenarioName) {
    const expectations = {
      multipleEnglish: 'PROCESS',
      singleEnglish: 'SKIP',
      noEnglish: 'SKIP',
      undefinedLanguage: 'SKIP',
      noAudio: 'SKIP',
      complexMultiLanguage: 'PROCESS'
    };
    return expectations[scenarioName] || 'UNKNOWN';
  }

  determineActualBehavior(testResult) {
    if (testResult.deduplicator.error || testResult.processor.error) {
      return 'ERROR';
    }

    const dedupResult = testResult.deduplicator.output;
    if (!dedupResult) {
      return 'ERROR';
    }

    // If deduplicator says to skip (outputNumber 2) or not process
    if (dedupResult.outputNumber === 2 || !dedupResult.processFile) {
      return 'SKIP';
    }

    // If deduplicator says to process (outputNumber 1) and processFile is true
    if (dedupResult.outputNumber === 1 && dedupResult.processFile) {
      return 'PROCESS';
    }

    return 'UNKNOWN';
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
      console.log(`  Expected: ${result.expectedBehavior}`);
      console.log(`  Actual: ${result.actualBehavior}`);
      
      if (result.deduplicator.error) {
        console.log(`  Deduplicator Error: ${result.deduplicator.error}`);
      }
      if (result.processor.error) {
        console.log(`  Processor Error: ${result.processor.error}`);
      }
      console.log('');
    });

    // Detailed analysis
    if (passed < total) {
      console.log('━━━ Failed Test Analysis ━━━');
      this.testResults
        .filter(r => !r.passed)
        .forEach(result => {
          console.log(`\n${result.scenario}:`);
          if (result.deduplicator.output) {
            console.log(`  Deduplicator outputNumber: ${result.deduplicator.output.outputNumber}`);
            console.log(`  Deduplicator processFile: ${result.deduplicator.output.processFile}`);
          }
          if (result.processor.output) {
            console.log(`  Processor outputNumber: ${result.processor.output.outputNumber}`);
            console.log(`  Processor processFile: ${result.processor.output.processFile}`);
          }
        });
    }

    console.log(`\n🎯 Test Suite ${passed === total ? 'PASSED' : 'FAILED'}`);
    
    if (passed === total) {
      console.log('All audio channel management tools are working correctly!');
    } else {
      console.log(`${total - passed} test(s) failed. Please review the implementation.`);
    }
  }
}

// Run tests if called directly
if (require.main === module) {
  const tester = new AudioToolsTester();
  tester.runTests().catch(error => {
    console.error(`Fatal test error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = AudioToolsTester;
