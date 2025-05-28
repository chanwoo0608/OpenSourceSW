import React, { useState, useEffect, useContext } from 'react'; // React import 추가
import axios from 'axios';
import { TimestampContext } from "./VideoInput.jsx";
import "./index.css";

// YouTube API 키
const API_KEY = "AIzaSyC3Wb74eaTb_mnKbV5RXZ607SZJI0or5hM";
// 타임스탬프 형식을 찾기 위한 정규식 (MM:SS 또는 HH:MM:SS)
const timestampRegex = /\b(?:\d+:)?\d{1,2}:\d{2}\b/g;

/**
 * YouTube 댓글 컴포넌트
 * - 비디오의 댓글을 가져와서 표시
 * - 타임스탬프가 포함된 댓글 필터링
 * - 타임스탬프 클릭 시 비디오 재생 위치 변경
 */
const VideoComments = ({ videoId, setPriorityTimestamps, setRegularTimestamps, onCommentsLoaded }) => {
  // 상태 관리
  const [comments, setComments] = useState([]); // UI 표시용 전체 필터링된 댓글
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  
  const timestampContext = useContext(TimestampContext) || {};
  const setCurrentTimestamp = timestampContext.setCurrentTimestamp || (() => console.warn('setCurrentTimestamp not available in VideoComments'));
  
  const [timestampFrequency, setTimestampFrequency] = useState({});
  const [priorityComments, setPriorityComments] = useState([]); // UI 표시용 우선순위 댓글
  const [otherComments, setOtherComments] = useState([]);     // UI 표시용 기타 댓글

  // Helper: Convert timestamp string to seconds
  const timestampToSeconds = (timestamp) => {
    if (!timestamp || typeof timestamp !== 'string') return 0;
    const parts = timestamp.split(":").map(Number);
    if (parts.some(isNaN)) return 0;

    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
  };

  /**
   * YouTube API를 사용하여 댓글 가져오기
   */
  const fetchComments = async () => {
    setLoading(true);
    setError(""); // 이전 에러 초기화
    setComments([]);
    setPriorityComments([]);
    setOtherComments([]);
    setTimestampFrequency({});
    // 부모 컴포넌트의 타임스탬프도 초기화
    setPriorityTimestamps && setPriorityTimestamps([]);
    setRegularTimestamps && setRegularTimestamps([]);

    let allFetchedCommentItems = [];
    let nextPageToken = null;

    try {
      do {
        const response = await axios.get(
          `https://www.googleapis.com/youtube/v3/commentThreads`,
          {
            params: {
              key: API_KEY,
              videoId: videoId,
              part: "snippet",
              maxResults: 100, // API 최대치
              order: "relevance", // 관련성 높은 댓글 우선
              pageToken: nextPageToken,
            },
          }
        );
        allFetchedCommentItems = allFetchedCommentItems.concat(response.data.items);
        nextPageToken = response.data.nextPageToken;
      } while (nextPageToken);

      const filteredComments = allFetchedCommentItems
        .map((item) => {
          const topLevelComment = item.snippet.topLevelComment;
          if (!topLevelComment) return null; // topLevelComment가 없는 경우 방지

          const text = topLevelComment.snippet.textDisplay;
          const timestamps = text.match(timestampRegex) || [];
          const likeCount = topLevelComment.snippet.likeCount || 0;
          return {
            id: topLevelComment.id, // 댓글 고유 ID
            text,
            likeCount,
            timestamps,
          };
        })
        .filter((comment) => comment && comment.timestamps.length > 0 && comment.likeCount > 20); // 좋아요 20개 초과

      // 타임스탬프 빈도수 계산 (±20초 그룹화)
      const allTimestampsFromFiltered = filteredComments.flatMap(c => c.timestamps);
      const allTimestampsInSeconds = allTimestampsFromFiltered.map(timestampToSeconds);
      const sortedSeconds = [...new Set(allTimestampsInSeconds)].sort((a, b) => a - b); // 중복 제거 후 정렬

      const groupLeaders = {}; // 각 초가 속한 그룹의 대표 초
      const groupCounts = {};  // 각 대표 초를 기준으로 한 그룹의 크기

      for (const sec of sortedSeconds) {
        let leader = sec;
        // 이미 그룹화된 리더를 찾거나, 자신보다 작은 값 중 20초 이내 가장 작은 값을 리더로 설정
        for (const existingLeaderSec of Object.keys(groupLeaders).map(Number)) {
            if (Math.abs(existingLeaderSec - sec) <= 20 && existingLeaderSec < leader) {
                leader = existingLeaderSec;
            }
        }
        groupLeaders[sec] = leader; // 현재 초(sec)의 리더는 leader
        groupCounts[leader] = (groupCounts[leader] || 0) + 1;
      }
      setTimestampFrequency({ ...groupCounts, _groupLeaders: groupLeaders });


      // 우선순위 댓글과 기타 댓글 분류
      const leaderToPriorityComment = {}; // 각 그룹 리더별 최고 좋아요 댓글 정보
      const usedAsPriority = new Set();   // 우선순위 댓글로 사용된 (댓글ID_타임스탬프) 조합

      filteredComments.forEach((comment) => {
        comment.timestamps.forEach((time) => {
          const sec = timestampToSeconds(time);
          const leaderSec = groupLeaders[sec] !== undefined ? groupLeaders[sec] : sec;

          // 해당 그룹(leaderSec)이 빈번하고 (2개 이상 언급)
          // 아직 해당 그룹의 우선순위 댓글이 없거나, 현재 댓글이 더 좋아요가 많으면 업데이트
          if (groupCounts[leaderSec] > 1) {
            if (!leaderToPriorityComment[leaderSec] || comment.likeCount > leaderToPriorityComment[leaderSec].comment.likeCount) {
              // 이전에 이 리더에 할당된 댓글이 있었다면, 그것은 이제 우선순위가 아님
              if (leaderToPriorityComment[leaderSec]) {
                usedAsPriority.delete(`${leaderToPriorityComment[leaderSec].comment.id}_${leaderToPriorityComment[leaderSec].time}`);
              }
              leaderToPriorityComment[leaderSec] = { comment, time };
              usedAsPriority.add(`${comment.id}_${time}`);
            }
          }
        });
      });

      let finalPriorityCommentsList = Object.values(leaderToPriorityComment);
      // 시간순 정렬 (UI 표시용)
      finalPriorityCommentsList.sort((a, b) => timestampToSeconds(a.time) - timestampToSeconds(b.time));
      setPriorityComments(finalPriorityCommentsList);

      let finalOtherCommentsList = [];
      filteredComments.forEach((comment) => {
        comment.timestamps.forEach((time) => {
          if (!usedAsPriority.has(`${comment.id}_${time}`)) {
            finalOtherCommentsList.push({ comment, time });
          }
        });
      });
      // 시간순 정렬 (UI 표시용)
      finalOtherCommentsList.sort((a, b) => timestampToSeconds(a.time) - timestampToSeconds(b.time));
      setOtherComments(finalOtherCommentsList);

      // App.jsx로 전달할 타임스탬프(초 단위) 배열 생성
      const priorityTimestampsInSeconds = finalPriorityCommentsList.map(item => timestampToSeconds(item.time));
      const regularTimestampsInSeconds = finalOtherCommentsList.map(item => timestampToSeconds(item.time));

      // 중복 제거 및 정렬 후 부모 컴포넌트로 전달
      const uniquePrioritySeconds = [...new Set(priorityTimestampsInSeconds)].sort((a, b) => a - b);
      const uniqueRegularSeconds = [...new Set(regularTimestampsInSeconds)].sort((a, b) => a - b);
      
      console.log("VideoComments: Sending priority timestamps to App:", uniquePrioritySeconds);
      setPriorityTimestamps && setPriorityTimestamps(uniquePrioritySeconds);
      
      console.log("VideoComments: Sending regular timestamps to App:", uniqueRegularSeconds);
      setRegularTimestamps && setRegularTimestamps(uniqueRegularSeconds);
      
      setComments(filteredComments); // UI 표시용 전체 필터링 댓글 상태 업데이트

      onCommentsLoaded && onCommentsLoaded(videoId); // 댓글 로드 완료 알림

    } catch (err) {
      console.error("Error fetching comments:", err.response ? err.response.data : err.message);
      setError(err.response?.data?.error?.message || "Failed to fetch comments. Check API key or network.");
      // 에러 발생 시 부모 컴포넌트의 타임스탬프도 초기화
      setPriorityTimestamps && setPriorityTimestamps([]);
      setRegularTimestamps && setRegularTimestamps([]);
    } finally {
      setLoading(false);
    }
  };

  /**
   * 타임스탬프 클릭 처리
   */
  const handleTimestampClick = (timestamp) => {
    setCurrentTimestamp(timestamp); // Context 업데이트 -> VideoPlayer에서 seek
  };

  // videoId 변경 시 댓글 자동 로드
  useEffect(() => {
    if (videoId) {
      fetchComments();
    } else {
      // videoId가 없으면 모든 관련 상태 초기화
      setComments([]);
      setPriorityComments([]);
      setOtherComments([]);
      setTimestampFrequency({});
      setError("");
      setLoading(false);
      setPriorityTimestamps && setPriorityTimestamps([]);
      setRegularTimestamps && setRegularTimestamps([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]); // API_KEY는 상수이므로 의존성 배열에서 제거, setPriority/RegularTimestamps는 App에서 오므로 변경되지 않음 가정

  return (
    <div>
      {loading && <div className="spinner"></div>}
      {error && <p style={{ color: "red" }}>{error}</p>}

      {(priorityComments.length > 0 || otherComments.length > 0) && !loading && (
        <div className="comments-container">
          {priorityComments.length > 0 && (
            <>
              <h3>우선순위 하이라이트</h3>
              <ul>
                {priorityComments.map(({ comment, time }, idx) => (
                  <li 
                    key={`priority-${comment.id}-${time}-${idx}`} // comment.id와 time, idx 조합으로 더 고유한 키
                    className="comment-item" 
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: '1px solid #eee', background: '#fffbe6', borderLeft: '4px solid #d47b06' }}
                  >
                    <span style={{ minWidth: 60, color: '#d47b06', fontWeight: 'bold', fontSize: '0.9em' }}>👍 {comment.likeCount}</span>
                    <button
                      onClick={() => handleTimestampClick(time)}
                      className="comment-timestamp"
                      style={{
                        background: 'none', border: 'none', color: '#d47b06',
                        textDecoration: 'underline', cursor: 'pointer', padding: '0 5px',
                        fontWeight: 'bold', fontSize: '0.95rem', textAlign: 'left'
                      }}
                      title={`Jump to ${time}`}
                    >
                      {time} <span title="Popular timestamp (mentioned multiple times)">★</span>
                    </button>
                    {/* <p style={{ margin: 0, fontSize: '0.85em', color: '#555', flexGrow: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} dangerouslySetInnerHTML={{ __html: comment.text.substring(0, 100) + (comment.text.length > 100 ? '...' : '') }} /> */}
                  </li>
                ))}
              </ul>
            </>
          )}

          {otherComments.length > 0 && (
            <>
              <h3>기타 타임스탬프</h3>
              <ul>
                {otherComments.map(({ comment, time }, idx) => (
                  <li 
                    key={`other-${comment.id}-${time}-${idx}`} // comment.id와 time, idx 조합
                    className="comment-item" 
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: '1px solid #eee' }}
                  >
                    <span style={{ minWidth: 60, color: '#777', fontWeight: 'normal', fontSize: '0.9em' }}>👍 {comment.likeCount}</span>
                    <button
                      onClick={() => handleTimestampClick(time)}
                      className="comment-timestamp"
                      style={{
                        background: 'none', border: 'none', color: '#065fd4',
                        textDecoration: 'underline', cursor: 'pointer', padding: '0 5px',
                        fontWeight: 'normal', fontSize: '0.95rem', textAlign: 'left'
                      }}
                      title={`Jump to ${time}`}
                    >
                      {time}
                    </button>
                    {/* <p style={{ margin: 0, fontSize: '0.85em', color: '#555', flexGrow: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} dangerouslySetInnerHTML={{ __html: comment.text.substring(0, 100) + (comment.text.length > 100 ? '...' : '') }} /> */}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {!loading && !error && comments.length === 0 && videoId && <p>No comments with timestamps found (or API error).</p>}
    </div>
  );
};

export default VideoComments;
